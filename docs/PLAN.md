# TechGear ERP - Implementation Plan

Plan of record for the build described in [SPEC.md](../SPEC.md). Nothing here is code yet.
Every decision below is either taken directly from SPEC.md or recorded in section 8 as a judgement call.

## 0. Ground rules and pinned versions

| Item           | Pin                       | Note                                                                                                    |
| -------------- | ------------------------- | ------------------------------------------------------------------------------------------------------- |
| Next.js        | `15.5.x`                  | SPEC fixes Next 15. Next 16 is out (16.3.5) but the stack is declared fixed, so we stay on 15.          |
| React          | `19.x`                    |                                                                                                         |
| Tailwind CSS   | `4.3.x`                   | v4 CSS-first config, `@theme` block, no `tailwind.config.ts` for tokens.                                |
| Prisma         | `7.10.x`                  | `latest` on npm currently resolves to `8.0.0-rc.15`, a release candidate. We pin the newest stable 7.x. |
| Auth.js        | `next-auth@5.0.0-beta.32` | v5 is still beta. See R-6.                                                                              |
| Playwright CLI | `@playwright/cli@0.1.21`  | Verified to exist on npm. Project also gets `playwright@1.63.x` as a dev dep.                           |
| Fonts          | `geist@1.7.x`             | Geist Sans + Geist Mono. See section 7 for why not Inter.                                               |

Cross-cutting invariants, enforced everywhere:

- **Money is `Int` centavos.** No floats, no `Decimal`, no `number` arithmetic on pesos. One `lib/money.ts` owns every conversion and every rounding decision.
- **Zod is the source of truth for types.** Every server action input is a Zod schema; TS types are `z.infer`. No `any`, no unchecked `as`.
- **Mutations are Server Actions.** Route handlers exist only for Auth.js, CSV export streams, and print/PDF routes. This is the one pattern SPEC section 2 asks us to pick.
- **Server-side authorization on every mutation.** The UI hiding a button is a convenience, never a control.
- **No em-dash characters in any user-visible string**, including seed data. This is taste-skill's hardest rule and it applies to product names, customer names, ticket bodies, and UI copy.

---

## 1. Prisma schema

Design notes that shape the schema:

- **Stock is a ledger.** `StockMovement` is append-only truth. `StockLevel` is a transactionally-maintained cache of it. Section 6 covers the mechanics.
- **Snapshots on transactional lines.** `OrderItem` stores `skuSnapshot`, `nameSnapshot`, `unitPriceCentavos`, and `unitCostCentavos`. Renaming a product later must not rewrite last year's margin report.
- **Soft delete only on catalogue and directory records** (`Product`, `ProductVariant`, `Category`, `Brand`, `Supplier`, `Customer`, `Warehouse`, `Promo`) via `deletedAt`. Ledger and transactional records (`Order`, `OrderItem`, `StockMovement`, `Payment`, `Refund`, `PurchaseOrder`, `AuditLog`) are **never** soft deleted. They are cancelled or voided by status. `User` uses `isActive` rather than `deletedAt`, because SPEC section 5.1 says "deactivate", not "delete".
- **Percentages are basis points** (`Int`, 10000 = 100%). Same reasoning as centavos.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================================
// ENUMS
// ============================================================

enum Role {
  ADMIN
  MANAGER
  SALES
  WAREHOUSE
}

enum AuditAction {
  CREATE
  UPDATE
  DELETE
  LOGIN
  LOGIN_FAILED
  LOGOUT
  STATUS_CHANGE
  PRICE_CHANGE
  STOCK_ADJUST
  EXPORT
}

enum ProductStatus {
  DRAFT
  ACTIVE
  ARCHIVED
}

enum StockMovementType {
  RECEIPT
  SALE
  RETURN
  ADJUSTMENT
  TRANSFER_IN
  TRANSFER_OUT
  WRITE_OFF
}

enum StockReason {
  PURCHASE_RECEIPT
  CUSTOMER_SALE
  CUSTOMER_RETURN
  DAMAGE
  LOSS
  THEFT
  COUNT_CORRECTION
  SAMPLE
  WARRANTY_REPLACEMENT
  TRANSFER
  OPENING_BALANCE
  OTHER
}

enum TransferStatus {
  DRAFT
  IN_TRANSIT
  RECEIVED
  CANCELLED
}

enum SalesChannel {
  POS
  SHOPEE
  LAZADA
  TIKTOK
  FACEBOOK
  DIRECT
  B2B
}

enum OrderStatus {
  DRAFT
  PENDING
  PAID
  PACKED
  SHIPPED
  DELIVERED
  COMPLETED
  CANCELLED
  REFUNDED
}

enum PaymentMethod {
  GCASH
  MAYA
  BANK_TRANSFER
  CARD
  CASH
  COD
}

enum PaymentStatus {
  PENDING
  PAID
  FAILED
  VOIDED
}

enum ReturnStatus {
  REQUESTED
  APPROVED
  REJECTED
  RECEIVED
  COMPLETED
}

enum ReturnDisposition {
  RESTOCK
  WRITE_OFF
}

enum WarrantyClaimStatus {
  SUBMITTED
  UNDER_REVIEW
  APPROVED
  REJECTED
  REPLACED
  REFUNDED
  CLOSED
}

enum PromoType {
  PERCENT
  FIXED
}

enum PurchaseOrderStatus {
  DRAFT
  SENT
  PARTIALLY_RECEIVED
  RECEIVED
  CLOSED
  CANCELLED
}

enum BillStatus {
  DRAFT
  OPEN
  PARTIALLY_PAID
  PAID
  VOID
}

enum PaymentTerms {
  COD
  NET_7
  NET_15
  NET_30
  NET_60
}

enum CustomerType {
  INDIVIDUAL
  BUSINESS
}

enum CustomerSegment {
  NEW
  REPEAT
  VIP
  DORMANT
}

enum AddressType {
  BILLING
  SHIPPING
  BUSINESS
}

enum LeadStage {
  NEW
  CONTACTED
  QUOTED
  NEGOTIATION
  WON
  LOST
}

enum ActivityType {
  CALL
  EMAIL
  MEETING
  TASK
}

enum ActivityStatus {
  OPEN
  DONE
  CANCELLED
}

enum TicketStatus {
  OPEN
  IN_PROGRESS
  WAITING_CUSTOMER
  RESOLVED
  CLOSED
}

enum TicketPriority {
  LOW
  MEDIUM
  HIGH
  URGENT
}

enum ExpenseCategory {
  RENT
  ADS
  SHIPPING
  SALARIES
  UTILITIES
  SUPPLIES
  SOFTWARE
  OTHER
}

enum NotificationType {
  LOW_STOCK
  OUT_OF_STOCK
  NEW_TICKET
  OVERDUE_TASK
  PO_RECEIVED
  ORDER_PLACED
  WARRANTY_CLAIM
}

// ============================================================
// AUTH, AUDIT, SECURITY
// ============================================================

model User {
  id           String    @id @default(cuid())
  email        String    @unique
  name         String
  passwordHash String
  role         Role      @default(SALES)
  isActive     Boolean   @default(true)
  avatarUrl    String?
  phone        String?
  lastLoginAt  DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  auditLogs              AuditLog[]
  ordersAsSalesperson    Order[]            @relation("OrderSalesperson")
  ordersCreated          Order[]            @relation("OrderCreatedBy")
  orderStatusEvents      OrderStatusEvent[]
  stockMovements         StockMovement[]
  stockAdjustments       StockAdjustment[]
  stockTransfers         StockTransfer[]
  purchaseOrdersCreated  PurchaseOrder[]    @relation("PoCreatedBy")
  purchaseOrdersApproved PurchaseOrder[]    @relation("PoApprovedBy")
  purchaseReceipts       PurchaseReceipt[]
  supplierPayments       SupplierPayment[]
  payments               Payment[]
  refunds                Refund[]
  returns                Return[]
  leads                  Lead[]
  activities             Activity[]
  ticketsAssigned        Ticket[]           @relation("TicketAssignee")
  ticketComments         TicketComment[]
  warrantyClaims         WarrantyClaim[]
  expenses               Expense[]
  notifications          Notification[]

  @@index([role, isActive])
}

model AuditLog {
  id         String      @id @default(cuid())
  actorId    String?
  actorEmail String                       // denormalized so the trail survives actor changes
  action     AuditAction
  entityType String
  entityId   String?
  summary    String                       // human-readable, rendered directly in the audit page
  changes    Json?                        // { field: { from, to } }
  ipAddress  String?
  userAgent  String?
  createdAt  DateTime    @default(now())

  actor User? @relation(fields: [actorId], references: [id], onDelete: SetNull)

  @@index([entityType, entityId])
  @@index([actorId, createdAt])
  @@index([action, createdAt])
  @@index([createdAt])
}

model LoginAttempt {
  id        String   @id @default(cuid())
  email     String
  ipAddress String
  success   Boolean
  createdAt DateTime @default(now())

  @@index([email, createdAt])
  @@index([ipAddress, createdAt])
}

model AppSetting {
  key       String   @id
  value     Json
  updatedAt DateTime @updatedAt
}

// ============================================================
// CATALOGUE
// ============================================================

model Category {
  id          String    @id @default(cuid())
  name        String
  slug        String    @unique
  description String?
  parentId    String?
  sortOrder   Int       @default(0)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime?

  parent   Category?  @relation("CategoryTree", fields: [parentId], references: [id], onDelete: SetNull)
  children Category[] @relation("CategoryTree")
  products Product[]

  @@index([parentId])
  @@index([deletedAt])
}

model Brand {
  id        String    @id @default(cuid())
  name      String
  slug      String    @unique
  logoUrl   String?
  website   String?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  products Product[]

  @@index([deletedAt])
}

model Product {
  id          String        @id @default(cuid())
  name        String
  slug        String        @unique
  description String        @default("")
  status      ProductStatus @default(ACTIVE)
  categoryId  String
  brandId     String
  tags        String[]      @default([])
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
  deletedAt   DateTime?

  category Category         @relation(fields: [categoryId], references: [id], onDelete: Restrict)
  brand    Brand            @relation(fields: [brandId], references: [id], onDelete: Restrict)
  variants ProductVariant[]
  images   ProductImage[]
  specs    ProductSpec[]

  @@index([categoryId, status])
  @@index([brandId, status])
  @@index([status, deletedAt])
  @@index([name])
}

model ProductImage {
  id        String  @id @default(cuid())
  productId String
  url       String
  alt       String
  sortOrder Int     @default(0)
  isPrimary Boolean @default(false)

  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@index([productId, sortOrder])
}

model ProductSpec {
  id        String @id @default(cuid())
  productId String
  key       String            // "Switch type", "Polling rate", "Connectivity"
  value     String            // "Gateron Yellow", "1000 Hz", "2.4 GHz + Bluetooth 5.1"
  sortOrder Int    @default(0)

  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([productId, key])
  @@index([productId, sortOrder])
}

model ProductVariant {
  id                String    @id @default(cuid())
  productId         String
  name              String                       // "Black / Gateron Brown / TKL"
  optionSummary     String                       // denormalized copy for list rendering, see D-4
  sku               String    @unique
  barcode           String?   @unique
  priceCentavos     Int
  compareAtCentavos Int?
  lastCostCentavos  Int       @default(0)        // cost of the most recent receipt
  avgCostCentavos   Int       @default(0)        // moving average, see section 6
  reorderLevel      Int       @default(0)
  reorderQty        Int       @default(0)
  weightGrams       Int?
  warrantyMonths    Int       @default(12)
  isActive          Boolean   @default(true)
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  deletedAt         DateTime?

  product         Product                   @relation(fields: [productId], references: [id], onDelete: Cascade)
  attributes      ProductVariantAttribute[]
  stockLevels     StockLevel[]
  stockMovements  StockMovement[]
  orderItems      OrderItem[]
  poItems         PurchaseOrderItem[]
  adjustmentItems StockAdjustmentItem[]
  transferItems   StockTransferItem[]
  warrantyClaims  WarrantyClaim[]
  tickets         Ticket[]

  @@index([productId])
  @@index([sku])
  @@index([barcode])
  @@index([deletedAt, isActive])
}

model ProductVariantAttribute {
  id        String @id @default(cuid())
  variantId String
  name      String            // "Color" | "Switch" | "Layout" | "Size"
  value     String            // "Black" | "Gateron Brown" | "TKL" | "L"
  sortOrder Int    @default(0)

  variant ProductVariant @relation(fields: [variantId], references: [id], onDelete: Cascade)

  @@unique([variantId, name])
  @@index([name, value])
}

// ============================================================
// WAREHOUSES AND THE STOCK LEDGER
// ============================================================

model Warehouse {
  id        String    @id @default(cuid())
  code      String    @unique               // "MNL-MAIN", "CEB-HUB"
  name      String
  isDefault Boolean   @default(false)
  isActive  Boolean   @default(true)
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  address        Address?
  stockLevels    StockLevel[]
  stockMovements StockMovement[]
  adjustments    StockAdjustment[]
  transfersOut   StockTransfer[]   @relation("TransferFrom")
  transfersIn    StockTransfer[]   @relation("TransferTo")
  orders         Order[]
  purchaseOrders PurchaseOrder[]
  returns        Return[]

  @@index([deletedAt, isActive])
}

/// Transactionally-maintained cache of the ledger. Never written outside the stock service.
model StockLevel {
  id          String   @id @default(cuid())
  variantId   String
  warehouseId String
  onHand      Int      @default(0)
  reserved    Int      @default(0)          // allocated to PENDING orders, not yet deducted
  updatedAt   DateTime @updatedAt

  variant   ProductVariant @relation(fields: [variantId], references: [id], onDelete: Cascade)
  warehouse Warehouse      @relation(fields: [warehouseId], references: [id], onDelete: Cascade)

  @@unique([variantId, warehouseId])
  @@index([warehouseId, onHand])
  @@index([variantId])
  // raw migration adds: CHECK (onHand >= 0 AND reserved >= 0 AND reserved <= onHand)
}

/// Append-only. The single source of truth for stock. Rows are never updated or deleted.
model StockMovement {
  id                   String            @id @default(cuid())
  variantId            String
  warehouseId          String
  type                 StockMovementType
  reason               StockReason
  qtyDelta             Int                               // signed: +receipt, -sale
  balanceAfter         Int                               // on-hand for this pair after applying
  unitCostCentavos     Int                               // cost attached to this movement
  avgCostAfterCentavos Int                               // variant moving average after applying
  note                 String?
  actorId              String?
  occurredAt           DateTime          @default(now())
  createdAt            DateTime          @default(now())

  orderItemId           String?
  purchaseReceiptItemId String?
  returnItemId          String?
  adjustmentItemId      String?
  transferItemId        String?

  variant             ProductVariant       @relation(fields: [variantId], references: [id], onDelete: Restrict)
  warehouse           Warehouse            @relation(fields: [warehouseId], references: [id], onDelete: Restrict)
  actor               User?                @relation(fields: [actorId], references: [id], onDelete: SetNull)
  orderItem           OrderItem?           @relation(fields: [orderItemId], references: [id], onDelete: SetNull)
  purchaseReceiptItem PurchaseReceiptItem? @relation(fields: [purchaseReceiptItemId], references: [id], onDelete: SetNull)
  returnItem          ReturnItem?          @relation(fields: [returnItemId], references: [id], onDelete: SetNull)
  adjustmentItem      StockAdjustmentItem? @relation(fields: [adjustmentItemId], references: [id], onDelete: SetNull)
  transferItem        StockTransferItem?   @relation(fields: [transferItemId], references: [id], onDelete: SetNull)

  @@index([variantId, occurredAt])
  @@index([warehouseId, occurredAt])
  @@index([type, occurredAt])
  @@index([occurredAt])
  @@index([orderItemId])
}

model StockAdjustment {
  id          String      @id @default(cuid())
  reference   String      @unique          // "ADJ-2026-0041"
  warehouseId String
  reason      StockReason
  note        String?
  actorId     String
  createdAt   DateTime    @default(now())

  warehouse Warehouse             @relation(fields: [warehouseId], references: [id], onDelete: Restrict)
  actor     User                  @relation(fields: [actorId], references: [id], onDelete: Restrict)
  items     StockAdjustmentItem[]

  @@index([warehouseId, createdAt])
}

model StockAdjustmentItem {
  id           String @id @default(cuid())
  adjustmentId String
  variantId    String
  qtyDelta     Int              // signed
  countedQty   Int?             // set when the adjustment came from a physical count
  note         String?

  adjustment StockAdjustment @relation(fields: [adjustmentId], references: [id], onDelete: Cascade)
  variant    ProductVariant  @relation(fields: [variantId], references: [id], onDelete: Restrict)
  movements  StockMovement[]

  @@index([adjustmentId])
  @@index([variantId])
}

model StockTransfer {
  id              String         @id @default(cuid())
  reference       String         @unique       // "TRF-2026-0012"
  fromWarehouseId String
  toWarehouseId   String
  status          TransferStatus @default(DRAFT)
  note            String?
  actorId         String
  shippedAt       DateTime?
  receivedAt      DateTime?
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  fromWarehouse Warehouse           @relation("TransferFrom", fields: [fromWarehouseId], references: [id], onDelete: Restrict)
  toWarehouse   Warehouse           @relation("TransferTo", fields: [toWarehouseId], references: [id], onDelete: Restrict)
  actor         User                @relation(fields: [actorId], references: [id], onDelete: Restrict)
  items         StockTransferItem[]

  @@index([fromWarehouseId, status])
  @@index([toWarehouseId, status])
}

model StockTransferItem {
  id          String @id @default(cuid())
  transferId  String
  variantId   String
  qty         Int
  qtyReceived Int    @default(0)

  transfer  StockTransfer  @relation(fields: [transferId], references: [id], onDelete: Cascade)
  variant   ProductVariant @relation(fields: [variantId], references: [id], onDelete: Restrict)
  movements StockMovement[]

  @@index([transferId])
  @@index([variantId])
}

// ============================================================
// PURCHASING
// ============================================================

model Supplier {
  id            String       @id @default(cuid())
  code          String       @unique
  name          String
  contactName   String?
  email         String?
  phone         String?
  leadTimeDays  Int          @default(7)
  paymentTerms  PaymentTerms @default(NET_30)
  onTimeRateBps Int          @default(0)     // 9450 = 94.50%
  defectRateBps Int          @default(0)
  notes         String?
  isActive      Boolean      @default(true)
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt
  deletedAt     DateTime?

  address        Address?
  purchaseOrders PurchaseOrder[]
  bills          SupplierBill[]

  @@index([deletedAt, isActive])
  @@index([name])
}

model PurchaseOrder {
  id               String              @id @default(cuid())
  poNumber         String              @unique         // "PO-2026-0087"
  supplierId       String
  warehouseId      String
  status           PurchaseOrderStatus @default(DRAFT)
  orderDate        DateTime            @default(now())
  expectedDate     DateTime?
  sentAt           DateTime?
  closedAt         DateTime?
  cancelledAt      DateTime?
  subtotalCentavos Int                 @default(0)
  discountCentavos Int                 @default(0)
  shippingCentavos Int                 @default(0)
  vatCentavos      Int                 @default(0)
  totalCentavos    Int                 @default(0)
  notes            String?
  createdById      String
  approvedById     String?
  createdAt        DateTime            @default(now())
  updatedAt        DateTime            @updatedAt

  supplier   Supplier            @relation(fields: [supplierId], references: [id], onDelete: Restrict)
  warehouse  Warehouse           @relation(fields: [warehouseId], references: [id], onDelete: Restrict)
  createdBy  User                @relation("PoCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)
  approvedBy User?               @relation("PoApprovedBy", fields: [approvedById], references: [id], onDelete: SetNull)
  items      PurchaseOrderItem[]
  receipts   PurchaseReceipt[]
  bills      SupplierBill[]

  @@index([supplierId, status])
  @@index([status, orderDate])
  @@index([warehouseId, status])
}

model PurchaseOrderItem {
  id                String @id @default(cuid())
  purchaseOrderId   String
  variantId         String
  qtyOrdered        Int
  qtyReceived       Int    @default(0)
  unitCostCentavos  Int
  discountCentavos  Int    @default(0)
  lineTotalCentavos Int

  purchaseOrder PurchaseOrder         @relation(fields: [purchaseOrderId], references: [id], onDelete: Cascade)
  variant       ProductVariant        @relation(fields: [variantId], references: [id], onDelete: Restrict)
  receiptItems  PurchaseReceiptItem[]

  @@index([purchaseOrderId])
  @@index([variantId])
}

/// One row per physical receiving event. Makes PARTIALLY_RECEIVED auditable.
model PurchaseReceipt {
  id              String   @id @default(cuid())
  reference       String   @unique                  // "GRN-2026-0154"
  purchaseOrderId String
  receivedById    String
  receivedAt      DateTime @default(now())
  note            String?

  purchaseOrder PurchaseOrder         @relation(fields: [purchaseOrderId], references: [id], onDelete: Cascade)
  receivedBy    User                  @relation(fields: [receivedById], references: [id], onDelete: Restrict)
  items         PurchaseReceiptItem[]

  @@index([purchaseOrderId, receivedAt])
}

model PurchaseReceiptItem {
  id                  String @id @default(cuid())
  receiptId           String
  purchaseOrderItemId String
  qtyReceived         Int
  unitCostCentavos    Int              // may differ from the ordered cost
  qtyRejected         Int    @default(0)

  receipt           PurchaseReceipt   @relation(fields: [receiptId], references: [id], onDelete: Cascade)
  purchaseOrderItem PurchaseOrderItem @relation(fields: [purchaseOrderItemId], references: [id], onDelete: Restrict)
  movements         StockMovement[]

  @@index([receiptId])
  @@index([purchaseOrderItemId])
}

model SupplierBill {
  id                 String     @id @default(cuid())
  billNumber         String     @unique
  supplierId         String
  purchaseOrderId    String?
  status             BillStatus @default(OPEN)
  issueDate          DateTime
  dueDate            DateTime
  subtotalCentavos   Int
  vatCentavos        Int        @default(0)
  totalCentavos      Int
  amountPaidCentavos Int        @default(0)
  notes              String?
  createdAt          DateTime   @default(now())
  updatedAt          DateTime   @updatedAt

  supplier      Supplier          @relation(fields: [supplierId], references: [id], onDelete: Restrict)
  purchaseOrder PurchaseOrder?    @relation(fields: [purchaseOrderId], references: [id], onDelete: SetNull)
  payments      SupplierPayment[]

  @@index([supplierId, status])
  @@index([status, dueDate])
}

model SupplierPayment {
  id             String        @id @default(cuid())
  billId         String
  amountCentavos Int
  method         PaymentMethod
  reference      String?
  paidAt         DateTime      @default(now())
  createdById    String

  bill      SupplierBill @relation(fields: [billId], references: [id], onDelete: Cascade)
  createdBy User         @relation(fields: [createdById], references: [id], onDelete: Restrict)

  @@index([billId])
  @@index([paidAt])
}

// ============================================================
// CRM
// ============================================================

model Customer {
  id                    String          @id @default(cuid())
  code                  String          @unique             // "CUS-04182"
  type                  CustomerType    @default(INDIVIDUAL)
  firstName             String?
  lastName              String?
  companyName           String?
  displayName           String                              // derived on write, indexed for search
  email                 String?
  phone                 String?
  taxId                 String?                             // TIN for B2B invoices
  sourceChannel         SalesChannel?
  segment               CustomerSegment @default(NEW)
  tags                  String[]        @default([])
  facebookHandle        String?
  instagramHandle       String?
  notes                 String?
  creditLimitCentavos   Int             @default(0)
  lifetimeValueCentavos Int             @default(0)         // maintained on order completion, see D-9
  orderCount            Int             @default(0)
  lastOrderAt           DateTime?
  isActive              Boolean         @default(true)
  createdAt             DateTime        @default(now())
  updatedAt             DateTime        @updatedAt
  deletedAt             DateTime?

  addresses        Address[]
  orders           Order[]
  leads            Lead[]
  activities       Activity[]
  tickets          Ticket[]
  returns          Return[]
  warrantyClaims   WarrantyClaim[]
  promoRedemptions PromoRedemption[]

  @@index([displayName])
  @@index([email])
  @@index([phone])
  @@index([segment, lastOrderAt])
  @@index([deletedAt, isActive])
}

model Address {
  id          String      @id @default(cuid())
  type        AddressType @default(SHIPPING)
  customerId  String?
  supplierId  String?     @unique
  warehouseId String?     @unique
  recipient   String?
  phone       String?
  line1       String
  line2       String?
  barangay    String
  city        String
  province    String
  postalCode  String
  country     String      @default("PH")
  isDefault   Boolean     @default(false)
  createdAt   DateTime    @default(now())

  customer    Customer?  @relation(fields: [customerId], references: [id], onDelete: Cascade)
  supplier    Supplier?  @relation(fields: [supplierId], references: [id], onDelete: Cascade)
  warehouse   Warehouse? @relation(fields: [warehouseId], references: [id], onDelete: Cascade)
  billingFor  Order[]    @relation("OrderBillingAddress")
  shippingFor Order[]    @relation("OrderShippingAddress")

  @@index([customerId, type])
  @@index([province, city])
}

model Lead {
  id                  String        @id @default(cuid())
  code                String        @unique              // "LEAD-0219"
  title               String
  contactName         String
  email               String?
  phone               String?
  company             String?
  stage               LeadStage     @default(NEW)
  position            Float         @default(0)          // kanban ordering within a column, see D-11
  valueCentavos       Int           @default(0)
  probabilityBps      Int           @default(0)
  source              SalesChannel?
  ownerId             String
  customerId          String?                            // set on conversion, links the lead to its customer
  expectedCloseDate   DateTime?
  wonAt               DateTime?
  lostAt              DateTime?
  lostReason          String?
  createdAt           DateTime      @default(now())
  updatedAt           DateTime      @updatedAt

  customer   Customer?  @relation(fields: [customerId], references: [id], onDelete: SetNull)
  owner      User       @relation(fields: [ownerId], references: [id], onDelete: Restrict)
  activities Activity[]

  @@index([stage, position])
  @@index([ownerId, stage])
  @@index([expectedCloseDate])
}

model Activity {
  id          String         @id @default(cuid())
  type        ActivityType
  status      ActivityStatus @default(OPEN)
  subject     String
  note        String?
  dueAt       DateTime?
  completedAt DateTime?
  ownerId     String
  customerId  String?
  leadId      String?
  ticketId    String?
  orderId     String?
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt

  owner    User      @relation(fields: [ownerId], references: [id], onDelete: Restrict)
  customer Customer? @relation(fields: [customerId], references: [id], onDelete: Cascade)
  lead     Lead?     @relation(fields: [leadId], references: [id], onDelete: Cascade)
  ticket   Ticket?   @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  order    Order?    @relation(fields: [orderId], references: [id], onDelete: SetNull)

  @@index([ownerId, status, dueAt])
  @@index([customerId, createdAt])
  @@index([leadId])
  @@index([dueAt, status])
}

model Ticket {
  id              String         @id @default(cuid())
  ticketNumber    String         @unique             // "TKT-2026-0338"
  subject         String
  description     String
  status          TicketStatus   @default(OPEN)
  priority        TicketPriority @default(MEDIUM)
  customerId      String
  assigneeId      String?
  orderId         String?
  variantId       String?
  slaDueAt        DateTime
  firstResponseAt DateTime?
  resolvedAt      DateTime?
  closedAt        DateTime?
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  customer   Customer        @relation(fields: [customerId], references: [id], onDelete: Restrict)
  assignee   User?           @relation("TicketAssignee", fields: [assigneeId], references: [id], onDelete: SetNull)
  order      Order?          @relation(fields: [orderId], references: [id], onDelete: SetNull)
  variant    ProductVariant? @relation(fields: [variantId], references: [id], onDelete: SetNull)
  comments   TicketComment[]
  activities Activity[]

  @@index([status, priority, slaDueAt])
  @@index([assigneeId, status])
  @@index([customerId, createdAt])
}

model TicketComment {
  id         String   @id @default(cuid())
  ticketId   String
  authorId   String
  body       String
  isInternal Boolean  @default(false)
  createdAt  DateTime @default(now())

  ticket Ticket @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  author User   @relation(fields: [authorId], references: [id], onDelete: Restrict)

  @@index([ticketId, createdAt])
}

// ============================================================
// SALES
// ============================================================

model Order {
  id                     String       @id @default(cuid())
  orderNumber            String       @unique           // "SO-2026-004182"
  channel                SalesChannel
  status                 OrderStatus  @default(DRAFT)
  customerId             String?                        // null for walk-in POS
  salespersonId          String?
  warehouseId            String
  billingAddressId       String?
  shippingAddressId      String?
  channelReference       String?                        // Shopee or Lazada order id
  placedAt               DateTime     @default(now())
  paidAt                 DateTime?
  packedAt               DateTime?
  shippedAt              DateTime?
  deliveredAt            DateTime?
  completedAt            DateTime?
  cancelledAt            DateTime?
  cancelReason           String?
  subtotalCentavos       Int          @default(0)       // VAT-inclusive, see D-6
  discountCentavos       Int          @default(0)
  shippingCentavos       Int          @default(0)
  vatCentavos            Int          @default(0)       // portion of total that is VAT
  totalCentavos          Int          @default(0)
  amountPaidCentavos     Int          @default(0)
  amountRefundedCentavos Int          @default(0)
  costTotalCentavos      Int          @default(0)       // COGS snapshot, drives margin reports
  promoId                String?
  promoCodeSnapshot      String?
  notes                  String?
  createdById            String?
  createdAt              DateTime     @default(now())
  updatedAt              DateTime     @updatedAt

  customer        Customer?          @relation(fields: [customerId], references: [id], onDelete: SetNull)
  salesperson     User?              @relation("OrderSalesperson", fields: [salespersonId], references: [id], onDelete: SetNull)
  createdBy       User?              @relation("OrderCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)
  warehouse       Warehouse          @relation(fields: [warehouseId], references: [id], onDelete: Restrict)
  billingAddress  Address?           @relation("OrderBillingAddress", fields: [billingAddressId], references: [id], onDelete: SetNull)
  shippingAddress Address?           @relation("OrderShippingAddress", fields: [shippingAddressId], references: [id], onDelete: SetNull)
  promo           Promo?             @relation(fields: [promoId], references: [id], onDelete: SetNull)
  items           OrderItem[]
  payments        Payment[]
  refunds         Refund[]
  returns         Return[]
  statusEvents    OrderStatusEvent[]
  tickets         Ticket[]
  activities      Activity[]
  promoRedemption PromoRedemption?

  @@index([status, placedAt])
  @@index([channel, placedAt])
  @@index([customerId, placedAt])
  @@index([salespersonId, placedAt])
  @@index([placedAt])
}

model OrderItem {
  id                   String @id @default(cuid())
  orderId              String
  variantId            String
  skuSnapshot          String
  nameSnapshot         String
  qty                  Int
  qtyReturned          Int    @default(0)
  unitPriceCentavos    Int
  discountCentavos     Int    @default(0)
  lineSubtotalCentavos Int                              // qty * unitPrice - discount, VAT-inclusive
  vatCentavos          Int                              // VAT portion of the line
  lineTotalCentavos    Int
  unitCostCentavos     Int                              // moving average at the moment of sale

  order          Order           @relation(fields: [orderId], references: [id], onDelete: Cascade)
  variant        ProductVariant  @relation(fields: [variantId], references: [id], onDelete: Restrict)
  movements      StockMovement[]
  returnItems    ReturnItem[]
  warrantyClaims WarrantyClaim[]

  @@index([orderId])
  @@index([variantId])
}

model OrderStatusEvent {
  id         String       @id @default(cuid())
  orderId    String
  fromStatus OrderStatus?
  toStatus   OrderStatus
  note       String?
  actorId    String?
  createdAt  DateTime     @default(now())

  order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)
  actor User? @relation(fields: [actorId], references: [id], onDelete: SetNull)

  @@index([orderId, createdAt])
}

model Payment {
  id               String        @id @default(cuid())
  orderId          String
  method           PaymentMethod
  status           PaymentStatus @default(PAID)
  amountCentavos   Int
  tenderedCentavos Int?                          // cash tendered at POS
  changeCentavos   Int?
  reference        String?                       // GCash ref no, card auth code
  paidAt           DateTime      @default(now())
  createdById      String?

  order     Order @relation(fields: [orderId], references: [id], onDelete: Cascade)
  createdBy User? @relation(fields: [createdById], references: [id], onDelete: SetNull)

  @@index([orderId])
  @@index([method, paidAt])
  @@index([paidAt])
}

model Refund {
  id             String        @id @default(cuid())
  orderId        String
  returnId       String?
  amountCentavos Int
  method         PaymentMethod
  reason         String
  reference      String?
  refundedAt     DateTime      @default(now())
  createdById    String?

  order     Order   @relation(fields: [orderId], references: [id], onDelete: Cascade)
  return    Return? @relation(fields: [returnId], references: [id], onDelete: SetNull)
  createdBy User?   @relation(fields: [createdById], references: [id], onDelete: SetNull)

  @@index([orderId])
  @@index([refundedAt])
}

model Return {
  id          String       @id @default(cuid())
  rmaNumber   String       @unique              // "RMA-2026-0091"
  orderId     String
  customerId  String
  warehouseId String
  status      ReturnStatus @default(REQUESTED)
  reason      String
  notes       String?
  requestedAt DateTime     @default(now())
  approvedAt  DateTime?
  receivedAt  DateTime?
  completedAt DateTime?
  createdById String?

  order     Order        @relation(fields: [orderId], references: [id], onDelete: Restrict)
  customer  Customer     @relation(fields: [customerId], references: [id], onDelete: Restrict)
  warehouse Warehouse    @relation(fields: [warehouseId], references: [id], onDelete: Restrict)
  createdBy User?        @relation(fields: [createdById], references: [id], onDelete: SetNull)
  items     ReturnItem[]
  refunds   Refund[]

  @@index([orderId])
  @@index([status, requestedAt])
  @@index([customerId])
}

model ReturnItem {
  id                   String            @id @default(cuid())
  returnId             String
  orderItemId          String
  qty                  Int
  disposition          ReturnDisposition @default(RESTOCK)
  refundAmountCentavos Int               @default(0)
  conditionNote        String?

  return    Return          @relation(fields: [returnId], references: [id], onDelete: Cascade)
  orderItem OrderItem       @relation(fields: [orderItemId], references: [id], onDelete: Restrict)
  movements StockMovement[]

  @@index([returnId])
  @@index([orderItemId])
}

model WarrantyClaim {
  id                String              @id @default(cuid())
  claimNumber       String              @unique      // "WC-2026-0058"
  orderItemId       String
  customerId        String
  variantId         String
  status            WarrantyClaimStatus @default(SUBMITTED)
  issueDescription  String
  resolution        String?
  serialNumber      String?
  warrantyExpiresAt DateTime
  submittedAt       DateTime            @default(now())
  resolvedAt        DateTime?
  assigneeId        String?
  createdAt         DateTime            @default(now())
  updatedAt         DateTime            @updatedAt

  orderItem OrderItem      @relation(fields: [orderItemId], references: [id], onDelete: Restrict)
  customer  Customer       @relation(fields: [customerId], references: [id], onDelete: Restrict)
  variant   ProductVariant @relation(fields: [variantId], references: [id], onDelete: Restrict)
  assignee  User?          @relation(fields: [assigneeId], references: [id], onDelete: SetNull)

  @@index([status, submittedAt])
  @@index([customerId])
  @@index([orderItemId])
}

model Promo {
  id                  String    @id @default(cuid())
  code                String    @unique
  description         String
  type                PromoType
  percentBps          Int?                          // 1000 = 10%, set when type = PERCENT
  amountCentavos      Int?                          // set when type = FIXED
  minSubtotalCentavos Int       @default(0)
  startsAt            DateTime
  endsAt              DateTime
  usageLimit          Int?
  usageCount          Int       @default(0)
  perCustomerLimit    Int?
  isActive            Boolean   @default(true)
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
  deletedAt           DateTime?

  orders      Order[]
  redemptions PromoRedemption[]

  @@index([isActive, startsAt, endsAt])
  // raw migration adds:
  //   CHECK ((type = 'PERCENT' AND percentBps IS NOT NULL AND amountCentavos IS NULL)
  //       OR (type = 'FIXED'   AND amountCentavos IS NOT NULL AND percentBps IS NULL))
}

model PromoRedemption {
  id                      String   @id @default(cuid())
  promoId                 String
  orderId                 String   @unique
  customerId              String?
  discountAppliedCentavos Int
  createdAt               DateTime @default(now())

  promo    Promo     @relation(fields: [promoId], references: [id], onDelete: Cascade)
  order    Order     @relation(fields: [orderId], references: [id], onDelete: Cascade)
  customer Customer? @relation(fields: [customerId], references: [id], onDelete: SetNull)

  @@index([promoId, customerId])
}

// ============================================================
// FINANCE AND OPS
// ============================================================

model Expense {
  id             String          @id @default(cuid())
  reference      String          @unique          // "EXP-2026-0233"
  category       ExpenseCategory
  description    String
  amountCentavos Int
  vatCentavos    Int             @default(0)
  vendor         String?
  incurredAt     DateTime
  createdById    String
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt

  createdBy User @relation(fields: [createdById], references: [id], onDelete: Restrict)

  @@index([category, incurredAt])
  @@index([incurredAt])
}

model Notification {
  id         String           @id @default(cuid())
  userId     String?                              // null = broadcast to targetRole
  targetRole Role?
  type       NotificationType
  title      String
  body       String
  link       String?
  readAt     DateTime?
  createdAt  DateTime         @default(now())

  user User? @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, readAt, createdAt])
  @@index([targetRole, createdAt])
}
```

### Constraints and indexes added by raw SQL migration

Prisma cannot express these, so a hand-written migration adds them:

| Purpose                     | SQL                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Stock cannot go negative    | `ALTER TABLE "StockLevel" ADD CONSTRAINT stock_nonneg CHECK ("onHand" >= 0 AND "reserved" >= 0 AND "reserved" <= "onHand")`            |
| Promo shape integrity       | the `CHECK` on `Promo` noted above                                                                                                     |
| Product and customer search | `CREATE EXTENSION pg_trgm;` then GIN trigram indexes on `Product.name`, `ProductVariant.sku`, `Customer.displayName`, `Customer.email` |
| Revenue rollups             | a partial index on `Order (status, placedAt) WHERE status IN ('PAID','DELIVERED','COMPLETED')`                                         |

### Soft-delete enforcement

A Prisma Client extension in `src/lib/db.ts` adds `deletedAt: null` to reads and turns `delete` into a `deletedAt` write for the eight soft-deletable models, with an explicit `withDeleted` escape hatch for the audit and reports pages. It is opt-out rather than opt-in so a forgotten filter fails closed.

---

## 2. Folder structure

Follows SPEC section 8 (`src/features/<module>/{components,actions,queries,schemas}`), with one addition: a `services/` folder per feature. SPEC section 8 also says "business logic in service functions, not components", and actions are the transport layer, so the logic needs somewhere to live that is callable from actions, from the seed script, and from Vitest without a request context.

```
techgear-erp/
├── .github/workflows/ci.yml
├── .claude/skills/design-taste-frontend/    # symlink to .agents/, see R-1
├── CLAUDE.md                                 # references DESIGN.md, Playwright rule
├── DESIGN.md                                 # Linear reference system (primary)
├── SPEC.md
├── docker-compose.yml                        # postgres:17
├── .env.example
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed/
│       ├── index.ts                          # orchestrator, fixed faker seed
│       ├── catalogue.ts                      # brands, categories, products, variants, specs
│       ├── warehouses.ts                     # warehouses and opening stock
│       ├── purchasing.ts                     # suppliers, POs, receipts, bills
│       ├── customers.ts                      # customers and PH addresses
│       ├── sales.ts                          # 400+ orders, payments, returns, warranty
│       ├── crm.ts                            # leads, activities, tickets
│       ├── finance.ts                        # expenses
│       └── data/                             # curated PH-market names, provinces, cities, barangays
├── docs/
│   ├── PLAN.md                               # this file
│   ├── design-direction.md
│   ├── permissions.md                        # generated from src/lib/rbac/matrix.ts
│   ├── status-flows.md                       # Mermaid state diagrams
│   ├── reference/{shopify,stripe,vercel}.DESIGN.md
│   └── screenshots/<page>-<light|dark>-<size>.png
├── e2e/
│   ├── auth.spec.ts
│   ├── product.spec.ts
│   ├── pos.spec.ts
│   ├── receiving.spec.ts
│   └── leads.spec.ts
├── scripts/
│   ├── fetch-product-images.ts               # see D-13
│   ├── shoot.ts                              # scripted screenshot sweep
│   └── gen-permissions-doc.ts
└── src/
    ├── app/
    │   ├── layout.tsx                        # theme provider, fonts, toaster
    │   ├── (auth)/login/page.tsx
    │   ├── (app)/
    │   │   ├── layout.tsx                    # sidebar, breadcrumbs, command palette, notifications
    │   │   ├── dashboard/
    │   │   ├── products/
    │   │   ├── inventory/
    │   │   ├── purchasing/
    │   │   ├── suppliers/
    │   │   ├── orders/
    │   │   ├── returns/
    │   │   ├── warranty/
    │   │   ├── customers/
    │   │   ├── leads/
    │   │   ├── activities/
    │   │   ├── tickets/
    │   │   ├── reports/
    │   │   ├── expenses/
    │   │   ├── promos/
    │   │   ├── settings/
    │   │   └── audit/
    │   ├── pos/                              # own layout, no sidebar, tablet-first
    │   ├── print/                            # receipts and invoices, print stylesheet
    │   ├── api/
    │   │   ├── auth/[...nextauth]/route.ts
    │   │   └── export/[report]/route.ts      # streamed CSV
    │   ├── forbidden.tsx                     # 403
    │   ├── not-found.tsx                     # 404
    │   ├── error.tsx
    │   └── global-error.tsx
    ├── features/
    │   ├── auth/{components,actions,queries,schemas,services}
    │   ├── products/
    │   ├── inventory/
    │   ├── purchasing/
    │   ├── suppliers/
    │   ├── orders/
    │   ├── pos/
    │   ├── returns/
    │   ├── customers/
    │   ├── leads/
    │   ├── activities/
    │   ├── tickets/
    │   ├── reports/
    │   ├── expenses/
    │   ├── promos/
    │   ├── notifications/
    │   ├── audit/
    │   └── users/
    ├── components/
    │   ├── ui/                               # shadcn primitives, customized, never default state
    │   ├── layout/                           # AppSidebar, Breadcrumbs, CommandPalette, ThemeToggle
    │   ├── data-table/                       # TanStack Table shell: server pagination, sort, filter, column visibility
    │   ├── charts/                           # Recharts wrappers built on the dataviz skill palette
    │   └── feedback/                         # EmptyState, Skeletons, ConfirmDialog, ErrorBoundary
    ├── lib/
    │   ├── db.ts                             # Prisma client and soft-delete extension
    │   ├── auth.ts                           # Auth.js v5 config
    │   ├── env.ts                            # Zod-validated process.env
    │   ├── money.ts                          # centavos arithmetic, peso formatting, overflow guard
    │   ├── vat.ts                            # 12% inclusive split and per-line allocation
    │   ├── rbac/
    │   │   ├── matrix.ts                     # single source of truth, typed
    │   │   ├── can.ts                        # can(user, 'orders.refund')
    │   │   └── guard.ts                      # requirePermission() for actions and pages
    │   ├── audit.ts
    │   ├── csv.ts
    │   ├── format.ts                         # en-PH dates, Asia/Manila, number formatting
    │   ├── numbering.ts                      # SO-, PO-, RMA- sequence generation
    │   └── errors.ts                         # InsufficientStockError, InvalidTransitionError
    ├── middleware.ts                         # route-level role gate
    └── test/                                 # Vitest setup, factories
```

**Feature folder contract.** Every feature folder uses the same five subfolders so a reviewer can predict the layout:

- `schemas/` Zod schemas, imported by both the client form and the server action.
- `services/` Business logic. No `next/headers`, no `auth()`. Unit testable and callable from the seed.
- `actions/` `"use server"` entry points. Parse with Zod, call `requirePermission`, call a service inside `db.$transaction` where needed, write the audit log, `revalidatePath`.
- `queries/` Read paths for server components. Server-paginated, explicit `select`, no N+1.
- `components/` Feature-specific UI. Generic primitives live in `src/components`.

---

## 3. Permission matrix

Single source of truth is `src/lib/rbac/matrix.ts`, typed as `Record<Permission, Role[]>`. `docs/permissions.md` is generated from it so the doc cannot drift. Enforced at three layers: `middleware.ts` for the route, `requirePermission()` in every action and protected page, and query scoping for `own`-limited rows.

Legend: `Y` full, `R` read only, `own` limited to records the user owns or created, `-` denied.

| Module                 | Action                                 | Admin | Manager |        Sales         | Warehouse |
| ---------------------- | -------------------------------------- | :---: | :-----: | :------------------: | :-------: |
| **Dashboard**          | view                                   |   Y   |    Y    |         own          |     Y     |
|                        | finance tiles (revenue, margin, AR/AP) |   Y   |    Y    |          -           |     -     |
|                        | ops tiles (low stock, POs due)         |   Y   |    Y    |          R           |     Y     |
| **Products**           | view                                   |   Y   |    Y    |          Y           |     Y     |
|                        | view cost and margin                   |   Y   |    Y    |          -           |     Y     |
|                        | create                                 |   Y   |    Y    |          -           |     -     |
|                        | update                                 |   Y   |    Y    |          -           |     -     |
|                        | archive (soft delete)                  |   Y   |    -    |          -           |     -     |
|                        | bulk price update                      |   Y   |    Y    |          -           |     -     |
|                        | CSV import                             |   Y   |    Y    |          -           |     -     |
|                        | CSV export                             |   Y   |    Y    |          Y           |     Y     |
| **Categories, Brands** | view                                   |   Y   |    Y    |          Y           |     Y     |
|                        | create, update                         |   Y   |    Y    |          -           |     -     |
|                        | delete                                 |   Y   |    -    |          -           |     -     |
| **Inventory**          | view stock levels                      |   Y   |    Y    |          R           |     Y     |
|                        | view stock ledger                      |   Y   |    Y    |          R           |     Y     |
|                        | create adjustment                      |   Y   |    Y    |          -           |     Y     |
|                        | create transfer                        |   Y   |    Y    |          -           |     Y     |
|                        | receive transfer                       |   Y   |    Y    |          -           |     Y     |
|                        | set reorder levels                     |   Y   |    Y    |          -           |     Y     |
| **Orders**             | view                                   |   Y   |    Y    |          Y           |     Y     |
|                        | view money columns                     |   Y   |    Y    |          Y           |     -     |
|                        | create, edit draft                     |   Y   |    Y    |          Y           |     -     |
|                        | mark paid, record payment              |   Y   |    Y    |          Y           |     -     |
|                        | pack, ship, deliver                    |   Y   |    Y    |          -           |     Y     |
|                        | complete                               |   Y   |    Y    |          Y           |     Y     |
|                        | cancel                                 |   Y   |    Y    | own (DRAFT, PENDING) |     -     |
|                        | refund                                 |   Y   |    Y    |          -           |     -     |
|                        | apply promo                            |   Y   |    Y    |          Y           |     -     |
|                        | print invoice, receipt                 |   Y   |    Y    |          Y           |     R     |
| **POS**                | open register, ring up sale            |   Y   |    Y    |          Y           |     -     |
|                        | manual discount                        |   Y   |    Y    |    own (max 10%)     |     -     |
|                        | void an in-progress cart               |   Y   |    Y    |          Y           |     -     |
| **Returns, RMA**       | view                                   |   Y   |    Y    |          Y           |     Y     |
|                        | create                                 |   Y   |    Y    |          Y           |     -     |
|                        | approve, reject                        |   Y   |    Y    |          -           |     -     |
|                        | receive goods, set disposition         |   Y   |    Y    |          -           |     Y     |
|                        | issue refund                           |   Y   |    Y    |          -           |     -     |
| **Warranty claims**    | view                                   |   Y   |    Y    |          Y           |     R     |
|                        | create                                 |   Y   |    Y    |          Y           |     -     |
|                        | review, approve, reject                |   Y   |    Y    |          -           |     -     |
|                        | fulfil replacement                     |   Y   |    Y    |          -           |     Y     |
| **Customers**          | view                                   |   Y   |    Y    |          Y           |     R     |
|                        | Customer 360 (LTV, AOV)                |   Y   |    Y    |          Y           |     -     |
|                        | create, update                         |   Y   |    Y    |          Y           |     -     |
|                        | soft delete                            |   Y   |    -    |          -           |     -     |
|                        | export                                 |   Y   |    Y    |          -           |     -     |
| **Leads**              | view board                             |   Y   |    Y    |          Y           |     -     |
|                        | create                                 |   Y   |    Y    |          Y           |     -     |
|                        | move stage (drag)                      |   Y   |    Y    |         own          |     -     |
|                        | reassign owner                         |   Y   |    Y    |          -           |     -     |
|                        | convert to customer                    |   Y   |    Y    |         own          |     -     |
|                        | delete                                 |   Y   |    Y    |          -           |     -     |
| **Activities**         | view all                               |   Y   |    Y    |          -           |     -     |
|                        | view and manage own                    |   Y   |    Y    |          Y           |     Y     |
|                        | assign to another user                 |   Y   |    Y    |          -           |     -     |
| **Tickets**            | view                                   |   Y   |    Y    |          Y           |     -     |
|                        | create, comment                        |   Y   |    Y    |          Y           |     -     |
|                        | internal note                          |   Y   |    Y    |          Y           |     -     |
|                        | assign, change priority                |   Y   |    Y    |          -           |     -     |
|                        | resolve, close                         |   Y   |    Y    |         own          |     -     |
| **Suppliers**          | view                                   |   Y   |    Y    |          -           |     Y     |
|                        | create, update                         |   Y   |    Y    |          -           |     -     |
|                        | soft delete                            |   Y   |    -    |          -           |     -     |
| **Purchase orders**    | view                                   |   Y   |    Y    |          -           |     Y     |
|                        | create, edit draft                     |   Y   |    Y    |          -           |     -     |
|                        | send to supplier                       |   Y   |    Y    |          -           |     -     |
|                        | receive stock                          |   Y   |    Y    |          -           |     Y     |
|                        | cancel, close                          |   Y   |    Y    |          -           |     -     |
| **Supplier bills**     | view                                   |   Y   |    Y    |          -           |     -     |
|                        | create, record payment                 |   Y   |    Y    |          -           |     -     |
|                        | void                                   |   Y   |    -    |          -           |     -     |
| **Promos**             | view                                   |   Y   |    Y    |          R           |     -     |
|                        | create, update, deactivate             |   Y   |    Y    |          -           |     -     |
| **Expenses**           | view                                   |   Y   |    Y    |          -           |     -     |
|                        | create, update                         |   Y   |    Y    |          -           |     -     |
|                        | delete                                 |   Y   |    -    |          -           |     -     |
| **Reports: sales**     | by product, category, channel          |   Y   |    Y    |          R           |     -     |
|                        | by salesperson                         |   Y   |    Y    |         own          |     -     |
| **Reports: inventory** | valuation, movement, slow-moving       |   Y   |    Y    |          -           |     Y     |
| **Reports: finance**   | gross profit, P&L, VAT summary         |   Y   |    Y    |          -           |     -     |
|                        | receivables and payables aging         |   Y   |    Y    |          -           |     -     |
| **Reports: CRM**       | customer LTV                           |   Y   |    Y    |          R           |     -     |
| **Reports**            | CSV export                             |   Y   |    Y    |      own scope       | own scope |
| **Users**              | view                                   |   Y   |    -    |          -           |     -     |
|                        | create, assign role, deactivate        |   Y   |    -    |          -           |     -     |
|                        | reset another user's password          |   Y   |    -    |          -           |     -     |
| **Own account**        | change own password, edit profile      |   Y   |    Y    |          Y           |     Y     |
| **Audit log**          | view                                   |   Y   |    R    |          -           |     -     |
| **Settings**           | company info, VAT rate, numbering      |   Y   |    -    |          -           |     -     |
| **Notifications**      | view and dismiss own                   |   Y   |    Y    |          Y           |     Y     |

**Calls made here that SPEC does not spell out:**

- **Warehouse sees quantities, not money.** Warehouse reads orders so they can pick and pack, but price, discount, VAT, and total are stripped server-side, not hidden with CSS. They do see product cost, because receiving requires entering it.
- **Sales sees all orders, not only their own.** A shared retail floor needs this. The order list defaults to a "Mine" filter they can clear. Cancel is the one order action scoped to `own`.
- **Manager is near-Admin minus destruction and user management.** No deletes, no user management, no voiding bills, no settings. Manager gets read-only audit access so they can investigate without being able to erase.
- **POS discount cap for Sales** is 10%. Deeper discounts need a Manager. Enforced in the POS service, not the UI.

---

## 4. Pages and routes

Roles listed are those who can load the route at all. Within a page, individual controls are gated by section 3. A denied route renders 403 with the missing permission named, never a silent redirect to the dashboard.

### Auth

| Route      | Page                                       | Roles  |
| ---------- | ------------------------------------------ | ------ |
| `/login`   | Sign in, with rate-limit lockout messaging | public |
| `/account` | Profile, change own password               | all    |

### Dashboard

| Route        | Page                                                                                                                                                                                                                                                                                                                                                                     | Roles |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| `/dashboard` | Role-aware. Admin and Manager: revenue today/week/month, gross margin, AOV, orders, channel mix, revenue trend, category breakdown, top products and customers, inventory value, low stock, open tickets, pipeline value. Sales: own sales, own pipeline, my tasks, open tickets. Warehouse: low and out of stock, POs to receive, transfers in transit, orders to pack. | all   |

### Products and catalogue

| Route                                 | Page                                                                                                                                                          | Roles                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `/products`                           | Server-paginated table. Filters: category, brand, stock status, price range, tags. Search, column visibility, saved-view tabs, CSV export, bulk price update. | all                         |
| `/products/new`                       | Create product with variant matrix builder                                                                                                                    | Admin, Manager              |
| `/products/[id]`                      | Variants, images, specs, stock by warehouse, sales history, margin                                                                                            | all                         |
| `/products/[id]/edit`                 | Edit product, specs, images                                                                                                                                   | Admin, Manager              |
| `/products/[id]/variants/[variantId]` | Variant detail, price and cost history, its own ledger                                                                                                        | all                         |
| `/products/import`                    | CSV import with column mapping and a dry-run diff                                                                                                             | Admin, Manager              |
| `/categories`                         | Category tree                                                                                                                                                 | all, edit Admin and Manager |
| `/brands`                             | Brand list                                                                                                                                                    | all, edit Admin and Manager |

### Inventory

| Route                        | Page                                                               | Roles                     |
| ---------------------------- | ------------------------------------------------------------------ | ------------------------- |
| `/inventory`                 | Stock by variant and warehouse: available, on hand, reserved       | all                       |
| `/inventory/alerts`          | Low and out of stock, reorder suggestions, "create PO" action      | Admin, Manager, Warehouse |
| `/inventory/ledger`          | Full movement ledger, filterable by variant, warehouse, type, date | all                       |
| `/inventory/adjustments`     | Adjustment list                                                    | Admin, Manager, Warehouse |
| `/inventory/adjustments/new` | Multi-line adjustment with reason                                  | Admin, Manager, Warehouse |
| `/inventory/transfers`       | Transfer list                                                      | Admin, Manager, Warehouse |
| `/inventory/transfers/new`   | New transfer                                                       | Admin, Manager, Warehouse |
| `/inventory/transfers/[id]`  | Detail and receive action                                          | Admin, Manager, Warehouse |
| `/inventory/lookup`          | Barcode or SKU lookup, tablet-friendly                             | all                       |

### Sales

| Route                         | Page                                                                              | Roles                                   |
| ----------------------------- | --------------------------------------------------------------------------------- | --------------------------------------- |
| `/orders`                     | Order table. Filters: status, channel, date range, salesperson, payment method    | all                                     |
| `/orders/new`                 | Create order for non-POS channels                                                 | Admin, Manager, Sales                   |
| `/orders/[id]`                | Items, discounts, VAT, shipping, payments, refunds, status timeline, action rail  | all                                     |
| `/orders/[id]/edit`           | Edit a DRAFT order                                                                | Admin, Manager, Sales                   |
| `/pos`                        | Register: barcode input, cart, discount, customer, split payment, cash and change | Admin, Manager, Sales                   |
| `/pos/receipt/[orderId]`      | Post-sale receipt with print action                                               | Admin, Manager, Sales                   |
| `/print/invoice/[orderId]`    | Printable A4 invoice                                                              | Admin, Manager, Sales                   |
| `/print/receipt/[orderId]`    | Printable 80mm thermal receipt                                                    | Admin, Manager, Sales                   |
| `/returns`                    | RMA list                                                                          | all                                     |
| `/returns/new`                | Start a return from an order                                                      | Admin, Manager, Sales                   |
| `/returns/[id]`               | Items, disposition, refund, status                                                | all                                     |
| `/warranty`                   | Claim list                                                                        | Admin, Manager, Sales, Warehouse (read) |
| `/warranty/[id]`              | Claim detail and resolution                                                       | Admin, Manager, Sales, Warehouse (read) |
| `/promos`                     | Promo code list                                                                   | Admin, Manager, Sales (read)            |
| `/promos/new`, `/promos/[id]` | Promo editor with usage stats                                                     | Admin, Manager                          |

### CRM

| Route                  | Page                                                                                           | Roles                 |
| ---------------------- | ---------------------------------------------------------------------------------------------- | --------------------- |
| `/customers`           | Customer table with segment filter                                                             | all, Warehouse read   |
| `/customers/new`       | Create with PH province, city, barangay fields                                                 | Admin, Manager, Sales |
| `/customers/[id]`      | Customer 360: LTV, AOV, last purchase, orders, tickets, warranty, activity timeline, addresses | Admin, Manager, Sales |
| `/customers/[id]/edit` | Edit                                                                                           | Admin, Manager, Sales |
| `/leads`               | Kanban, six columns, dnd-kit, per-column value totals                                          | Admin, Manager, Sales |
| `/leads/[id]`          | Lead detail, activities, convert to customer                                                   | Admin, Manager, Sales |
| `/activities`          | All activities                                                                                 | Admin, Manager        |
| `/activities/mine`     | My tasks, grouped overdue / today / this week                                                  | all                   |
| `/tickets`             | Queue with SLA countdown                                                                       | Admin, Manager, Sales |
| `/tickets/[id]`        | Thread, internal notes, linked order and product                                               | Admin, Manager, Sales |

### Purchasing

| Route                      | Page                                          | Roles                     |
| -------------------------- | --------------------------------------------- | ------------------------- |
| `/suppliers`               | Directory with on-time and defect rates       | Admin, Manager, Warehouse |
| `/suppliers/[id]`          | Detail, PO history, bills, performance        | Admin, Manager, Warehouse |
| `/purchasing`              | PO list by status                             | Admin, Manager, Warehouse |
| `/purchasing/new`          | Create PO, reorder suggestions prefilled      | Admin, Manager            |
| `/purchasing/[id]`         | PO detail, receipt history, bill link         | Admin, Manager, Warehouse |
| `/purchasing/[id]/receive` | Receiving: per-line qty, actual cost, rejects | Admin, Manager, Warehouse |
| `/purchasing/bills`        | Supplier bills and payables                   | Admin, Manager            |
| `/purchasing/bills/[id]`   | Bill detail, record payment                   | Admin, Manager            |

### Finance and reports

| Route                             | Page                                            | Roles                                              |
| --------------------------------- | ----------------------------------------------- | -------------------------------------------------- |
| `/reports`                        | Report index                                    | Admin, Manager, Sales (subset), Warehouse (subset) |
| `/reports/sales`                  | By product, category, channel, salesperson      | Admin, Manager, Sales (read)                       |
| `/reports/gross-profit`           | Revenue, COGS, margin by period                 | Admin, Manager                                     |
| `/reports/inventory-valuation`    | On hand times moving-average cost, by warehouse | Admin, Manager, Warehouse                          |
| `/reports/stock-movement`         | Ledger summary by type and period               | Admin, Manager, Warehouse                          |
| `/reports/slow-moving`            | No sales in N days, capital tied up             | Admin, Manager, Warehouse                          |
| `/reports/purchases`              | Spend by supplier and period                    | Admin, Manager                                     |
| `/reports/aging`                  | Receivables and payables buckets                | Admin, Manager                                     |
| `/reports/customer-ltv`           | LTV, AOV, segment distribution                  | Admin, Manager, Sales (read)                       |
| `/reports/vat`                    | Output VAT, input VAT, net payable              | Admin, Manager                                     |
| `/reports/pl`                     | Simple profit and loss                          | Admin, Manager                                     |
| `/expenses`                       | Expense list                                    | Admin, Manager                                     |
| `/expenses/new`, `/expenses/[id]` | Expense editor                                  | Admin, Manager                                     |

### Admin and system

| Route                                         | Page                                                          | Roles                 |
| --------------------------------------------- | ------------------------------------------------------------- | --------------------- |
| `/settings`                                   | Company info, VAT rate, numbering prefixes, default warehouse | Admin                 |
| `/settings/users`                             | User list                                                     | Admin                 |
| `/settings/users/new`, `/settings/users/[id]` | Create, assign role, deactivate, reset password               | Admin                 |
| `/audit`                                      | Filterable audit log: actor, action, entity, date range       | Admin, Manager (read) |
| `/notifications`                              | Notification centre                                           | all                   |
| `/forbidden`                                  | 403, names the missing permission and offers a route back     | all                   |
| `/not-found`                                  | 404                                                           | all                   |

Global on every `(app)` route: sidebar, breadcrumbs, theme toggle, notification bell, and a command palette on `Ctrl/Cmd+K` that searches products, variants by SKU, customers, and orders by number, and jumps to pages.

---

## 5. Status flows

`docs/status-flows.md` carries the same content as Mermaid state diagrams. Transitions run through a shared `transition()` helper per entity, built from a typed `Record<Status, Status[]>`. There is no direct status assignment anywhere in the codebase. Illegal transitions throw `InvalidTransitionError` and are unit tested.

### 5.1 Order

```
DRAFT      -> PENDING, CANCELLED
PENDING    -> PAID, CANCELLED
PAID       -> PACKED, CANCELLED, REFUNDED
PACKED     -> SHIPPED, CANCELLED, REFUNDED
SHIPPED    -> DELIVERED, REFUNDED
DELIVERED  -> COMPLETED, REFUNDED
COMPLETED  -> REFUNDED
CANCELLED  -> terminal
REFUNDED   -> terminal
```

Side effects, all inside the same transaction as the status write:

| Transition                   | Stock                                                        | Money                                     | Other                                                           |
| ---------------------------- | ------------------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------- |
| `DRAFT -> PENDING`           | `reserved += qty` per line                                   | none                                      | fails if any line lacks available stock                         |
| `PENDING -> PAID`            | `onHand -= qty`, `reserved -= qty`, `SALE` movement per line | `Payment` rows must cover `totalCentavos` | `costTotalCentavos` snapshotted from the current moving average |
| `PAID -> PACKED`             | none                                                         | none                                      |                                                                 |
| `PACKED -> SHIPPED`          | none                                                         | none                                      |                                                                 |
| `SHIPPED -> DELIVERED`       | none                                                         | none                                      |                                                                 |
| `DELIVERED -> COMPLETED`     | none                                                         | none                                      | customer LTV, order count, segment recomputed                   |
| `DRAFT/PENDING -> CANCELLED` | `reserved -= qty`, no movement                               | none                                      |                                                                 |
| `PAID/PACKED -> CANCELLED`   | `RETURN` movement restocking each line at its snapshot cost  | full `Refund` if paid                     |                                                                 |
| `* -> REFUNDED`              | driven by the Return flow, per-item disposition              | `Refund` rows                             | only a full-value refund sets this status, see D-19             |

**POS orders skip the ladder.** A POS sale runs `DRAFT -> PENDING -> PAID -> COMPLETED` inside a single transaction, because the customer leaves with the goods. The intermediate `OrderStatusEvent` rows are still written so the timeline stays honest.

**Marketplace orders start at PENDING**, since Shopee and Lazada have already taken the order.

### 5.2 Purchase order

```
DRAFT              -> SENT, CANCELLED
SENT               -> PARTIALLY_RECEIVED, RECEIVED, CANCELLED
PARTIALLY_RECEIVED -> PARTIALLY_RECEIVED, RECEIVED, CLOSED
RECEIVED           -> CLOSED
CLOSED             -> terminal
CANCELLED          -> terminal
```

- Status after a receipt is computed, never chosen. All lines fully received gives `RECEIVED`; some lines received gives `PARTIALLY_RECEIVED`.
- `CLOSED` from `PARTIALLY_RECEIVED` is a deliberate short-close, requires a reason, and is Admin or Manager only.
- `CANCELLED` is blocked once any receipt exists. Received goods cannot be un-received; the correction path is an adjustment or a supplier return.
- Only receiving creates `RECEIPT` movements and touches moving-average cost.

### 5.3 Lead

```
NEW         -> CONTACTED, LOST
CONTACTED   -> QUOTED, NEW, LOST
QUOTED      -> NEGOTIATION, CONTACTED, WON, LOST
NEGOTIATION -> WON, LOST, QUOTED
WON         -> terminal
LOST        -> NEW
```

- One step backward is allowed so a mis-drag on the kanban is recoverable.
- Forward skips are rejected. Dragging `NEW` onto `NEGOTIATION` fails with a toast naming the missing step, and the card animates back to its column.
- `WON` requires a linked or newly created `Customer` and is terminal. `LOST` requires a reason and can be reopened to `NEW`.
- `position` is rewritten only for the affected column on each drop.

### 5.4 Ticket

```
OPEN             -> IN_PROGRESS, WAITING_CUSTOMER, RESOLVED, CLOSED
IN_PROGRESS      -> WAITING_CUSTOMER, RESOLVED, OPEN
WAITING_CUSTOMER -> IN_PROGRESS, RESOLVED, CLOSED
RESOLVED         -> CLOSED, OPEN
CLOSED           -> OPEN
```

- `firstResponseAt` is stamped by the first non-internal staff comment, not by a status change.
- SLA due time is set on create from priority: URGENT 4h, HIGH 8h, MEDIUM 24h, LOW 72h, counted in Asia/Manila business hours.
- Reopening a `CLOSED` ticket is allowed within 7 days. After that the UI offers a linked new ticket instead.

### 5.5 Warranty claim

```
SUBMITTED    -> UNDER_REVIEW, REJECTED
UNDER_REVIEW -> APPROVED, REJECTED
APPROVED     -> REPLACED, REFUNDED
REJECTED     -> CLOSED, UNDER_REVIEW
REPLACED     -> CLOSED
REFUNDED     -> CLOSED
CLOSED       -> terminal
```

- A claim can only be raised against an `OrderItem` whose order reached `DELIVERED` or later and whose warranty has not expired. `warrantyExpiresAt` is computed at claim creation from `Order.deliveredAt` plus `ProductVariant.warrantyMonths`.
- `APPROVED -> REPLACED` issues a zero-value replacement order with a real `SALE` movement at the current moving-average cost, so the unit leaves stock and the cost lands in the P&L as warranty expense instead of vanishing.
- `APPROVED -> REFUNDED` writes a `Refund` against the original order.
- `REJECTED -> UNDER_REVIEW` is the appeal path, Manager or Admin only.

### 5.6 Return / RMA

```
REQUESTED -> APPROVED, REJECTED
APPROVED  -> RECEIVED, REJECTED
RECEIVED  -> COMPLETED
REJECTED  -> terminal
COMPLETED -> terminal
```

- `RECEIVED -> COMPLETED` is the only transition with stock and money effects. Per `ReturnItem`: `RESTOCK` writes a `RETURN` movement at the original `OrderItem.unitCostCentavos`; `WRITE_OFF` writes a `WRITE_OFF` movement that leaves on-hand alone and books the cost to loss.
- `OrderItem.qtyReturned` is incremented. A return can never exceed `qty - qtyReturned`.
- Refunds are written at completion and may be partial.

---

## 6. Stock ledger design

### 6.1 The two tables

`StockMovement` is append-only and is the truth. `StockLevel` is a cache of it that exists only so `/products` and `/inventory` do not have to sum the ledger on every page load. Every write to `StockLevel` happens in the same transaction as the `StockMovement` row that justifies it, and only through `src/features/inventory/services/stock.ts`. Nothing else in the codebase touches `StockLevel`.

Each movement stores `balanceAfter` (on-hand for that variant and warehouse after applying) and `avgCostAfterCentavos`. That makes the ledger page readable as a running balance with no recomputation, and makes drift detectable by comparing the newest `balanceAfter` against `StockLevel.onHand`.

### 6.2 Movement types and their effects

| Type           | `qtyDelta` | Touches `onHand`  | Touches `reserved`       | Recomputes moving average                     | Source                                                              |
| -------------- | ---------- | ----------------- | ------------------------ | --------------------------------------------- | ------------------------------------------------------------------- |
| `RECEIPT`      | `+qty`     | yes               | no                       | **yes**                                       | PO receipt, opening balance                                         |
| `SALE`         | `-qty`     | yes               | releases the reservation | no, consumes at the current average           | Order `PENDING -> PAID`, POS                                        |
| `RETURN`       | `+qty`     | yes               | no                       | **yes**, at the original sale's snapshot cost | Return item with `RESTOCK`                                          |
| `ADJUSTMENT`   | signed     | yes               | no                       | no, enters or leaves at the current average   | Count correction, damage, loss                                      |
| `TRANSFER_OUT` | `-qty`     | yes (source)      | no                       | no                                            | Transfer dispatch                                                   |
| `TRANSFER_IN`  | `+qty`     | yes (destination) | no                       | no                                            | Transfer receipt                                                    |
| `WRITE_OFF`    | `0`        | no                | no                       | no                                            | Return item with `WRITE_OFF`, books cost to loss without restocking |

`available = onHand - reserved`. Every sell-side check uses `available`, never `onHand`.

### 6.3 Moving-average cost

One average per **variant**, global across warehouses (see D-8). It lives on `ProductVariant.avgCostCentavos` and is recomputed only by `RECEIPT` and restocking `RETURN` movements:

```
newAvgCentavos = round(
  (qtyOnHandBefore * avgCostBefore + qtyIn * unitCostCentavos)
  / (qtyOnHandBefore + qtyIn)
)
```

where `qtyOnHandBefore` is total on-hand across **all** warehouses.

Rules that keep this honest:

- **Integer math throughout.** The numerator can reach roughly `10^4 x 10^7 = 10^11`, which overflows `Int32`. Intermediates are computed as JS `number`, exact to `2^53` so safe at this magnitude, and the result is `Math.round`ed back to an `Int`. The SQL equivalent casts to `bigint`. There is a unit test at that boundary.
- **The first receipt seeds the average.** If `qtyOnHandBefore <= 0`, `newAvg = unitCostCentavos`, rather than dividing by zero or weighting against negative stock.
- **COGS is snapshotted, not looked up.** At `PENDING -> PAID` each `OrderItem.unitCostCentavos` is stamped with the average at that instant and `Order.costTotalCentavos` is their sum. Later receipts move the average but never rewrite historical margin. Every gross-profit report reads the snapshot.
- **Restocked returns reverse their own cost.** A `RESTOCK` return re-enters at `OrderItem.unitCostCentavos`, the exact cost that left, and recomputes the average. The reversal is symmetric instead of injecting today's average into last quarter's stock.
- **Adjustments and transfers do not move the average.** They enter or leave at the current average, so valuation changes but cost per unit does not. A transfer is cost-neutral by construction, which is what a single global average implies.
- **Valuation is recomputed, never accumulated.** `/reports/inventory-valuation` computes `SUM(onHand * avgCostCentavos)` fresh, so per-movement rounding residue cannot compound into a drifting total.

### 6.4 Preventing overselling

Three independent defences, because one is always a bug away from negative stock.

**1. Conditional atomic decrement.** The deduction is a single statement whose `WHERE` clause _is_ the stock check, so there is no read-then-write window:

```sql
UPDATE "StockLevel"
   SET "onHand"   = "onHand"   - $qty,
       "reserved" = "reserved" - $qty
 WHERE "variantId"   = $variantId
   AND "warehouseId" = $warehouseId
   AND "onHand"      >= $qty
   AND "reserved"    >= $qty
```

If `rowCount !== 1` the service throws `InsufficientStockError` naming the SKU and the shortfall, and the transaction rolls back. Reservation at `DRAFT -> PENDING` uses the same shape against `("onHand" - "reserved") >= $qty`.

**2. Database CHECK constraints.** `CHECK (onHand >= 0 AND reserved >= 0 AND reserved <= onHand)` on `StockLevel`. If any future code path bypasses the service, Postgres rejects the write instead of silently recording negative stock.

**3. Deterministic lock ordering.** Order lines are sorted by `variantId` before the loop, so two concurrent orders touching the same two SKUs take row locks in the same sequence and cannot deadlock each other. Deadlock (`40P01`) and serialization failure (`40001`) are still caught and the whole transaction retried once with jitter before the error surfaces.

**Transaction boundaries.** SPEC section 8 names four. Receiving and warranty replacement are added because they have the same shape.

| Flow                         | Inside one `db.$transaction`                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Order placement, POS sale    | order, items, promo redemption, reserve, deduct, movements, payments, status events, customer rollups                 |
| PO receipt                   | receipt, receipt items, PO item `qtyReceived`, PO status, movements, `StockLevel`, moving average, `lastCostCentavos` |
| Refund and return completion | return items, dispositions, restock or write-off movements, refund rows, `qtyReturned`, order status                  |
| Stock transfer               | `TRANSFER_OUT` at source, `TRANSFER_IN` at destination, both `StockLevel` rows, transfer status                       |
| Stock adjustment             | adjustment, items, movements, `StockLevel`                                                                            |
| Warranty replacement         | replacement order, `SALE` movement, claim status                                                                      |

Isolation stays at Postgres default `READ COMMITTED`. The conditional update is atomic on its own, so `SERIALIZABLE` would buy retries rather than correctness. Transaction timeout 10s, max wait 5s.

### 6.5 Invariants, tested

1. For every `(variantId, warehouseId)`, `SUM(qtyDelta)` over all movements equals `StockLevel.onHand`.
2. The newest movement's `balanceAfter` equals `StockLevel.onHand`.
3. `onHand >= 0` and `0 <= reserved <= onHand` for every row.
4. `SUM(OrderItem.qty)` for orders at `PAID` or beyond equals `-SUM(qtyDelta)` over `SALE` movements.
5. `ProductVariant.avgCostCentavos` equals the `avgCostAfterCentavos` of its most recent average-changing movement.

These ship both as `npm run db:verify` and as Vitest cases over a scripted sequence of receipts, sales, returns, adjustments, and transfers.

---

## 7. Design direction

I fetched and read the actual source documents rather than working from memory: `design-md/linear.app/DESIGN.md`, the Shopify, Stripe and Vercel files from `awesome-design-md`, and `skills/taste-skill/SKILL.md` from Leonxlnx/taste-skill. Section 8 records where those documents differ from what SPEC.md assumes.

### 7.1 The design read

taste-skill section 0 wants a one-line read before anything else:

> A dense internal tool for a Philippine peripherals retailer. Calm, sharp, fast to scan. Linear's chrome, Shopify's commerce vocabulary, Stripe's numeric discipline, with quiet mechanical-keyboard character.

Its three dials, with the overrides an application UI requires:

| Dial               | Value | Why                                                                                                                                                                                                                                                                                 |
| ------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DESIGN_VARIANCE`  | **4** | taste-skill's "Linear-style" row suggests 5 to 6, but its high-variance moves (asymmetric grids, anti-center bias, massive empty zones) are landing-page tools. An ERP earns trust by being predictable. Variance is spent on page composition, never on making a table surprising. |
| `MOTION_INTENSITY` | **3** | Hover, focus and press states, the dnd-kit drag transform, and the command palette transition. No scroll-triggered reveals anywhere. At dial 3, `prefers-reduced-motion` is effectively already the baseline.                                                                       |
| `VISUAL_DENSITY`   | **8** | The important override, and the one that makes this look like a product. taste-skill's 8 to 10 band gives exactly the right instructions: tight padding, no card boxes around data, 1px lines instead of container chrome, and mono for every number.                               |

`VISUAL_DENSITY: 8` also settles a direct conflict. Linear's `DESIGN.md` says "mono only in code contexts, not on chrome", while SPEC section 3.1 asks for monospace on SKUs, prices and IDs. SPEC section 3.2 gives `DESIGN.md` authority over values and taste-skill authority over personality, and this is a personality question about an app rather than a value question about Linear's marketing site. **SKUs, barcodes, order numbers, quantities and money are set in Geist Mono with `tabular-nums`; everything else is Geist Sans.** Recorded in `docs/design-direction.md`.

### 7.2 What comes from Linear (primary reference)

Kept as documented:

- **The four-step surface ladder.** canvas, surface-1, surface-2, surface-3, with 1px hairlines carrying hierarchy and **no drop shadows** anywhere except the command palette and dropdown overlays. This is the single most valuable borrowed idea, because it is what lets a data-dense page stay calm.
- **The radius scale exactly:** 4px chips and status badges, 6px inline tags, 8px buttons and inputs, 12px panels, 16px the largest container. Never pill on buttons. That is a documented rule, which is what taste-skill's SHAPE CONSISTENCY LOCK asks for.
- **4px spacing base:** 4, 8, 12, 16, 24, 32, 48. Table cells at 8px vertical by 12px horizontal; panel padding 16px rather than Linear's 24px, which is a marketing-card value.
- **Button padding 8px by 14px, input padding 8px by 12px**, straight from the reference.
- **Type scale compressed for app use.** Linear's 80px display has no place in an ERP, but its ratios and negative-tracking discipline do. Scale starts at `page-title 24px/600/-0.4px`, then `section 18px/600/-0.2px`, `body 14px/400/0`, `body-sm 13px/400/0`, `caption 12px/400/0`, `mono 13px/400/tabular`. Linear's "pair display 600 with body 400, resist 700+" is kept.
- **Accent used scarcely:** brand mark, primary action, focus ring, active nav item, selected row indicator. Never a card fill, never a section background.
- **Focus ring is a 2px accent outline**, as documented.

Deliberate departures:

- **Light mode has to be invented.** Linear's own "Known Gaps" states that light mode is undocumented because the marketing site does not ship one. SPEC requires both. We invert the ladder and keep the relationships identical (hairline contrast, ink steps, accent scarcity), then verify every pair numerically.
- **The accent is not lavender.** SPEC 3.2 asks for a TechGear identity, and taste-skill's LILA RULE bans AI-purple as a default reach. See 7.4.
- **No product screenshots as the protagonist.** That is a marketing device. Here the data is the protagonist.

### 7.3 What comes from Shopify and Stripe (secondary)

A finding worth stating plainly: the files at `design-md/shopify/DESIGN.md` and `design-md/stripe/DESIGN.md` analyse those brands' **marketing sites**, not the Shopify admin (Polaris) or the Stripe Dashboard. Shopify's documents pill-only buttons, mint and pistachio accents and Neue Haas at weight 330. Stripe's documents a gradient mesh across the upper third of every page. Both collide head-on with Linear, and SPEC 3.2 says Linear wins. So these two contribute **almost no visual tokens**. They are saved to `docs/reference/` as SPEC requires, and what we actually take is the interaction and information design those brands are known for in their product surfaces.

**From Shopify, e-commerce patterns:**

- **Two-axis order status.** Payment state and fulfilment state read as separate badges rather than one overloaded word. `OrderStatus` stays the single enum SPEC 5.3 asks for, but the order row renders it as a payment chip plus a fulfilment chip, which is why `PAID` and `PACKED` never look like competing ideas.
- **Tonal status badges, not coloured dots.** Five tones: subdued, info, success, warning, critical. Flat tinted background, 4px radius, 12px mono label, no leading dot. taste-skill bans decorative status dots, and a tonal chip carries the same meaning with less noise.
- **Resource-list conventions:** sticky saved-view tabs above the table (All, Unfulfilled, Unpaid, Open), a selection column that swaps the toolbar for a bulk-action bar, a persistent result count. Identical on products, orders, customers and POs so the behaviour is learned once.
- **Product and variant editor:** one product page with the variant matrix underneath; per-variant SKU, barcode, price, cost and reorder level edited inline.
- **Inventory adjust drawer:** quantity, reason and note captured together, because an adjustment without a reason is unauditable.
- **Empty states that name the next action**, not a shrug.

**From Stripe, charts and finance:**

- **Tabular figures wherever numbers align.** Stripe's own analysis calls out `tnum` on any cell containing money. `font-variant-numeric: tabular-nums` goes on mono and on every numeric column, and money is right-aligned. This one detail does more for the "real product" impression than anything else on the list.
- **KPI tile anatomy:** small-caps label, large mono value, signed delta against the comparison period, bare sparkline beneath. No filled background track, no card chrome at density 8.
- **Every date range carries a comparison.** "vs. previous period" as a muted ghost line on trend charts and a signed delta on tiles. This is what makes a seeded dashboard read as analysis rather than decoration.
- **Restrained chart palette.** One accent hue with a lightness ramp for sequential data, and a small categorical set only where categories genuinely differ, such as channel mix. The `dataviz` skill is loaded before the first line of chart code and its palette is adapted to our accent rather than invented.
- **Money and time detail pages** structured as summary header, then timeline, then line items. Order and PO detail pages follow that shape.
- **No gradient mesh.** It is the thing Stripe is most known for visually, and it is exactly wrong here.

From **Vercel**, per SPEC's "only if needed": nothing beyond empty-state terseness. A fourth voice does not get pulled in unless a specific screen demands it.

### 7.4 TechGear identity

The accent replaces Linear's lavender. The constraints are tight: taste-skill allows one accent under 80% saturation and bans AI-purple as a default; the ERP semantics already claim green (success, paid, in stock), amber (warning, low stock, pending) and red (danger, cancelled, out of stock), so the brand hue has to stay clear of all three at badge size. That leaves the cyan-teal gap around hue 190, which is also where the gear-shop character lives. The accent is **Aqua**, named after the switch family, and it appears as an accent, never as a fill.

Token values, with WCAG ratios computed rather than assumed:

| Token                         | Light                             | Dark                              | Checked against   | Ratio L / D   |
| ----------------------------- | --------------------------------- | --------------------------------- | ----------------- | ------------- |
| `accent` (filled action)      | `#0B6E82` with white text         | `#2BB8CE` with `#04161A` text     | button label      | 5.89 / 7.80   |
| `accent-strong` (link, focus) | `#075B6D`                         | `#5FD2E3`                         | canvas            | 7.51 / 11.21  |
| `canvas`                      | `#FCFCFD`                         | `#08090B`                         |                   |               |
| `surface-1 / 2 / 3`           | `#F6F7F9` / `#F1F3F5` / `#EAEDF0` | `#101214` / `#16181B` / `#1C1F23` |                   |               |
| `hairline`                    | `#E3E6EA`                         | `#23252A`                         |                   |               |
| `ink`                         | `#0D1114`                         | `#F5F7F8`                         | canvas            | 18.50 / 18.54 |
| `ink-subtle`                  | `#5C646E`                         | `#8B929C`                         | canvas, surface-1 | 5.85 / 5.98   |
| `success`                     | `#0F7A3D`                         | `#3DD68C`                         | canvas            | 5.42 / 10.62  |
| `warning`                     | `#8A5A00`                         | `#E8B339`                         | canvas            | 5.93 / 10.38  |
| `danger`                      | `#B3261E`                         | `#F87171`                         | canvas            | 6.54 / 7.20   |

Every pair passes WCAG AA or better. Note that the dark-mode filled action uses **dark text on a bright accent**, because white on a mid-cyan only reaches 3.11 and would fail body-text contrast. These land in a single Tailwind v4 `@theme` block as CSS variables and feed the shadcn theme, so both modes come from one definition instead of a pile of `dark:` utilities.

Character, applied sparingly and only where it earns its place:

- The keycap motif appears **once**, in the brand mark: a squircle with the top-edge highlight Linear's reference describes on lifted panels. It is not repeated as decoration.
- Keyboard-first interaction _is_ the personality. Command palette, `/` to focus search, `j` and `k` for row navigation, `Enter` to open, barcode input permanently focused at POS. For a keyboard shop this reads as intent rather than novelty.
- Switch-colour language in the variant UI: the swatch beside a switch variant uses that switch's real colour. Semantic, not decorative.

### 7.5 Anti-slop checklist, enforced on every UI task

From taste-skill sections 4, 6 and 9, checked before any screenshot is accepted:

- No gradients on chrome, no outer glows, no pure `#000000` or `#ffffff`, no custom cursors.
- No emoji as icons. `lucide-react` per SPEC's fixed stack, which taste-skill permits on explicit request.
- **Zero em-dash and en-dash characters** in any user-visible string, including every seeded product name, customer name, ticket body and note.
- No "Jane Doe" data. Seeded people get realistic Filipino names, real province, city and barangay combinations, and `+63 9XX` numbers that are plausible and uneven rather than round.
- No fake-perfect numbers. Seeded revenue, on-time rates and defect rates are messy.
- Every table gets a real empty state, a skeleton matching its own column layout, and an error state. No generic spinners.
- Every button label fits on one line and passes contrast against its own background. Every input, placeholder, helper and error passes AA against its section background.
- One radius system, one accent, one neutral family, locked across the whole app.
- Theme is set once in `app/layout.tsx`. No section inverts.

### 7.6 Verification loop

Per SPEC 3.3, no UI task is done from reading code. After each page: start the dev server, drive it with `playwright-cli`, capture **1440, 1024 and 390 in both light and dark**, snapshot the accessibility tree, read the console and network for errors, compare against `DESIGN.md`, fix, recapture. At least one fix-and-recheck loop whenever something looks off. Final images land in `docs/screenshots/<page>-<light|dark>-<size>.png`, and `CLAUDE.md` carries the line SPEC asks for verbatim.

---

## 8. Risks and decisions

### 8.1 Corrections to SPEC where the world differs from the document

| #   | Finding                                                                                                                                                                                                                                                                                             | What we do                                                                                                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R-1 | ~~The skill name in SPEC 3.1 does not exist.~~ **Corrected during Phase 0: this finding was wrong.** The repo folder is `skills/taste-skill/`, but the skills.sh registry publishes it as `design-taste-frontend`, which is also the `name:` in its own frontmatter. SPEC's command works verbatim. | `npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend"` ran clean and installed to `.agents/skills/design-taste-frontend/`, symlinked into `.claude/skills/`. No fallback needed. |
| R-2 | **The Linear path in SPEC 3.2 is wrong.** The folder is `design-md/linear.app/DESIGN.md`, not `design-md/linear/`. `shopify`, `stripe` and `vercel` match as written.                                                                                                                               | Use the correct path. All four files are already fetched.                                                                                                                                                          |
| R-3 | **The Shopify and Stripe files document marketing sites, not Polaris or the Stripe Dashboard.** They prescribe pill-only buttons, mint accents and a gradient mesh, all of which contradict Linear.                                                                                                 | Save them to `docs/reference/` as SPEC requires, but take interaction and information patterns from them rather than tokens. Explained in 7.3 and repeated in `docs/design-direction.md`.                          |
| R-4 | **Linear's `DESIGN.md` documents no light mode**, by its own admission. SPEC requires light and dark.                                                                                                                                                                                               | Derive a light ladder that preserves Linear's relationships, then verify every token pair with a contrast script. Values and ratios in 7.4.                                                                        |
| R-5 | **Prisma's `latest` npm tag currently resolves to `8.0.0-rc.15`**, a release candidate. A fresh clone following the README must not pull an rc.                                                                                                                                                     | Pin `prisma` and `@prisma/client` to `7.10.x` explicitly.                                                                                                                                                          |
| R-6 | **Auth.js v5 is still beta** (`next-auth@5.0.0-beta.32`). SPEC fixes it.                                                                                                                                                                                                                            | Use it as specified, pin the exact beta, and keep all auth logic behind `src/lib/auth.ts` so a stable v5 bump touches one file.                                                                                    |
| R-7 | `@playwright/cli` does exist on npm at `0.1.21`, so the SPEC install line works.                                                                                                                                                                                                                    | No change. A `scripts/shoot.ts` fallback using `playwright` directly is kept in case the global install is unavailable in CI.                                                                                      |

### 8.2 Decisions made where SPEC is ambiguous

| #    | Ambiguity                                                                                  | Decision and reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1  | SPEC 2: "Server Actions or route handlers, pick one"                                       | **Server Actions** for every mutation. Route handlers only for Auth.js, streamed CSV export and print routes, which are GETs and not mutations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D-2  | SPEC 8 lists four feature subfolders but also demands service functions                    | Add `services/` to every feature. Actions stay thin: validate, authorize, call service, audit, revalidate. Services are what Vitest and the seed call.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D-3  | Variant options are listed as "(color, switch, layout, size)" with no model named          | A `ProductVariantAttribute` child table, one row per option. Normalized, no JSON blob, and no three-table option system that would add joins to every product list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D-4  | Same, for list rendering cost                                                              | `ProductVariant.optionSummary` is a denormalized string ("Black / Gateron Brown / TKL") maintained on write, so the products table never joins attributes for 50 rows. Deliberate denormalization, written in exactly one service.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D-5  | SPEC 6 says "soft-delete where sensible" without saying where                              | Soft delete on catalogue and directory records only: Product, ProductVariant, Category, Brand, Supplier, Customer, Warehouse, Promo. Never on Order, OrderItem, StockMovement, Payment, Refund, PurchaseOrder or AuditLog. User uses `isActive`, matching SPEC 5.1's "deactivate". A ledger that can be deleted is not a ledger.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D-6  | SPEC says "12% VAT" but not inclusive or exclusive                                         | **VAT-inclusive pricing**, the Philippine retail norm and what a shelf price means. `vatCentavos = round(total * 12 / 112)`. Line-level VAT is allocated per line with the rounding remainder assigned to the largest line, so lines always sum exactly to the order VAT. Unit tested.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D-7  | Overselling prevention is required but unspecified                                         | Reserve at `PENDING`, deduct at `PAID`, `available = onHand - reserved`. Conditional atomic `UPDATE`, plus DB `CHECK` constraints, plus deterministic lock ordering with one retry. Full detail in 6.4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D-8  | Moving-average cost across multiple warehouses                                             | **One average per variant, global.** Per-warehouse averages would make every transfer a cost event and would make "what did this cost us" depend on which shelf it sat on. Trade-off recorded: transfers become cost-neutral by construction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D-9  | Segments are "automatic" with no trigger named                                             | Stored on `Customer.segment`, recomputed inside the order-completion transaction and by `npm run db:segments`. VIP is top-decile lifetime value or 20+ orders; Repeat is 2+ orders; Dormant is no order in 180 days, checked first; New otherwise. Dormant needs the script because nothing happens at the moment a customer goes quiet. **Changed in Phase 6:** the plan said 10+ orders, which tagged a quarter of the seeded customers as VIP; 20 keeps VIP near the top tenth. The rules are one pure function shared by the seed, the refresh button, the script and the order hook.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D-10 | Whether Sales sees all orders, and whether Warehouse sees money                            | Sales sees all orders with a "Mine" filter on by default; only cancel is scoped to own. Warehouse reads orders for picking and packing, but money columns are removed **server-side**, not hidden in CSS. Warehouse does see product cost, because receiving requires entering it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D-11 | Kanban ordering for dnd-kit                                                                | `Lead.position` as a `Float`, new position is the midpoint of its neighbours, with a column rebalance when the gap falls below a threshold. Only the affected column is rewritten on a drop.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D-12 | Auth.js session strategy and stale roles                                                   | JWT sessions, no adapter tables, since credentials-only auth needs none. Role travels in the token for the middleware route gate, but **every server action re-reads `role` and `isActive` from the database** before authorizing. A deactivated user is locked out on their next action, not on their next login.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D-13 | Product images, with no asset pipeline in scope and taste-skill banning broken image links | `scripts/fetch-product-images.ts` downloads deterministic `picsum.photos/seed/<sku>` images into `public/products/` once, committed to the repo. The app then has real images and runs with no network.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D-14 | "Invoices and receipts as printable pages and PDF"                                         | Print-optimized routes under `/print/*` with a dedicated stylesheet, plus browser print-to-PDF. A server-rendered PDF library goes in the README's next steps rather than being half-built. **Changed in Phase 7:** the PDF is real, see D-35.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D-15 | Seed determinism versus "the last 12 months"                                               | Fixed faker seed so names, prices and distributions are identical on every run, but dates are generated relative to the run date so the dashboard is never empty. The 11.11 and 12.12 spikes land on the most recent occurrence of those dates. The shape is deterministic; the window moves.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D-16 | Search implementation                                                                      | `pg_trgm` GIN indexes on product name, SKU, customer name and email via raw SQL migration. `ILIKE '%term%'` cannot use a btree index and would be the first thing to fall over at 60+ products, 150+ variants and 120 customers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D-17 | CI scope, given SPEC 9 lists lint, typecheck and unit tests but SPEC also wants e2e        | CI runs lint, typecheck and Vitest exactly as SPEC 9 states. A second workflow runs Playwright against a Postgres service container and is allowed to be non-blocking, so a flaky browser run never red-lights the repo.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D-18 | `Int` money ceiling                                                                        | `Int` caps a row at 2,147,483,647 centavos, about PHP 21.4M, far above any plausible single order or line here. Report aggregates cast to `bigint` in SQL and are `BigInt` in TypeScript. `lib/money.ts` throws on overflow rather than wrapping silently.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D-19 | Partial refunds and order status                                                           | An order becomes `REFUNDED` only on a full-value refund. Partial refunds write `Refund` rows and increment `amountRefundedCentavos` while the status stays put, because a partly refunded delivered order is still a delivered order.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D-20 | Warranty replacements and stock                                                            | A replacement is a zero-value order with a real `SALE` movement at current average cost. The unit leaves inventory and the cost lands in the P&L as warranty expense instead of disappearing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D-21 | Lock ordering in 6.4 assumed per-row `StockLevel` locks taken in `variantId` order         | **Lock the `ProductVariant` row instead**, all of a flow's variants in one `SELECT ... ORDER BY id COLLATE "C" FOR UPDATE`. One lock then guards the variant's positions in every warehouse and its moving average, which per-level locks cannot: two receipts into different warehouses would both read the old average. Document locks (the numbering counter, or the transfer or order row) are always taken before any variant lock.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D-22 | Movement timestamps under concurrency                                                      | `occurredAt` comes from the database clock after the variant lock is held, forced 1 ms past the variant's previous movement. A timestamp taken before the lock lets a waiting transaction stamp itself earlier than the one it waited for, and the running balance reads out of order.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D-23 | Whether reorder levels apply per warehouse or company wide                                 | **Alerts per warehouse position, reorder suggestions company wide.** An empty Cebu shelf beside a full Manila one is a transfer, not a purchase, so alerts offer a prefilled transfer when another warehouse can spare units. Suggestions use the (s, nQ) reorder-point policy on available stock plus open purchase orders. Both measure available (on hand less reserved), since that is what can be sold.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D-24 | Document numbering                                                                         | Gapless per prefix and Manila calendar year, from a counter row in `AppSetting` incremented with `INSERT ... ON CONFLICT DO UPDATE`. The first number in a year floors on the table, so seeded documents never collide. The counter lock serialises documents of one kind, an accepted cost at this scale.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D-25 | What the ticket SLA measures, and in which hours                                           | **Resolution**, not first response, counted in **business hours: Monday to Saturday, 9:00 to 18:00 Manila**, public holidays not modelled. First response is still recorded, stamped by the first reply the customer can see, never by an internal note or a status change. Reopening sets a fresh target from the reopen time; changing priority recomputes the target from creation. Closing without resolving also stops the clock.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D-26 | Win probability when a lead changes stage                                                  | Every stage change resets probability to the stage default (10, 25, 50, 75, 100, 0 percent). Salespeople can override it on the lead until the next move. Pipeline forecasts stay honest without anyone remembering to update a number.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D-27 | Who may edit a lead's details, and who owns a ticket Sales opens                           | Editing a lead is working it, so it uses `leads.moveStage` (own for Sales). A ticket opened by someone without `tickets.assign` is assigned to them, so it lands in "Mine" and they can resolve it under their own scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D-28 | How Won relates to conversion                                                              | Conversion is the only way into Won. A lead is converted into a new customer built from its contact details (no address yet; Customer 360 asks for one) or linked to an existing account. The address check in `db:verify` excludes customers tagged `from-lead` for that reason.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D-29 | When a promo use is counted                                                                | **When the order is saved, draft included,** under the promo's row lock, so a code with ten uses left cannot be promised to eleven quotes; cancelling gives the use back. Eligibility (dates, usage limit, per-customer limit, minimum spend) is one pure function shared by the form preview, the service and the seed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D-30 | Manual discounts on keyed-in orders                                                        | The `pos.discount` scope governs a manual discount wherever it is keyed: "own" is the capped kind (10 percent of the subtotal, promos excluded), enforced in the order service.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D-31 | The order discounts apply in                                                               | Line discounts, then the promo on what is left (its minimum spend measured there too), then the manual order discount on what is left after the promo, then shipping, which is never discounted. Header discounts and goods VAT are spread over the lines by the largest-remainder method so every line sums to its header. The seed prices orders with the same function.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D-32 | Split payments and cash on delivery                                                        | Tenders must add up to exactly the balance: never short, never over. Only cash has a tendered amount and change, and cash is one tender. COD settles a whole order on its own, never at the counter, and is accepted as payment when the order moves to Paid (the courier remits it). A zero-value order is paid with no tenders at all.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D-33 | What a returned unit refunds                                                               | The difference of two cumulative shares of the line's discounted total, so returning a line one unit at a time refunds exactly its total. Shipping is refunded once per order, on request. Refunds never exceed paid less refunded. D-19 is refined: an order reads as refunded when all the money or every unit has gone back.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D-34 | Write-offs and warranty refunds                                                            | A write-off moves no unit, so it is one zero-quantity `WRITE_OFF` row per unit and each row's cost is one unit's loss. A warranty refund pays one unit's share, writes the faulty unit off and counts it as returned, so it cannot come back twice.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D-35 | Real PDF invoices and receipts                                                             | Drawn server-side with pdf-lib from the same document model as the printable page, using the PDF standard fonts so nothing is embedded. Those fonts are WinAnsi only, so amounts carry no peso sign (the currency is named in the column header, as PH invoices usually do) and any other unsupported character is transliterated rather than failing the render.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D-36 | Who prints documents                                                                       | Every invoice and receipt carries prices, so printing needs `orders.viewMoney` as well as `orders.print`. The matrix's "Warehouse R" on print therefore yields no document for Warehouse, in keeping with D-10; they see pick quantities on the order itself.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D-37 | Sales document numbers                                                                     | SO, RMA and WC numbers restart every Manila calendar year and carry the year they were raised in, SO with six digits. The seed numbers its history the same way instead of stamping every order with the current year.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D-38 | How a POS sale reaches Completed without packing or shipping                               | **It walks the ladder instead of jumping it.** The register calls `createOrder` with the paid intent, then `advanceOrder` through Packed, Shipped, Delivered (noted "Handed over at the counter") and Completed, in the same transaction. The transition map gains no POS-only edge, every step is checked, and the timeline has the same shape as the seeded POS history. Completed is what makes a counter sale returnable and refreshes the customer rollup.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D-40 | Supplier prices and VAT                                                                    | **Supplier prices are VAT-exclusive**, as Philippine B2B price lists are, so a PO and a bill add 12% on top of goods and freight, while sales prices stay VAT-inclusive (D-6). Stock enters at the net unit cost because input VAT is claimable. Freight is billed with the order but not capitalised into unit cost; landed-cost allocation is a next step.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D-41 | Rejected units at receiving                                                                | A receipt line records accepted and rejected units separately. Only accepted units write a `RECEIPT` movement or move the average; rejected ones go back to the supplier and **stay outstanding on the PO**, so a replacement delivery can bring them in. A delivery may not bring more than is outstanding, counting both. A delivery rejected in full leaves the status where it was, but still blocks cancelling, because it was booked.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D-42 | Where supplier on-time and defect rates come from                                          | **Measured, never typed.** Every goods received note is one delivery: on time if it lands on or before the PO's expected date in Manila calendar days, and defect rate is rejected units over units that arrived. The receiving service recomputes the supplier's rates in the same transaction as each receipt, the seed uses the same function, and `db:verify` re-measures them. The rate fields left the supplier form. A supplier with no deliveries has no rate, which the directory shows instead of 0%.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D-43 | Bills, matching and duplicates                                                             | A bill is the supplier's invoice under our own SB number with their invoice number beside it; the same supplier invoice cannot be entered twice unless the first was voided. Billing a PO needs something to have arrived, and the form starts from what arrived and is not yet billed (received at delivery cost, plus freight). Payments lock the bill and can never exceed its balance; a bill with any payment cannot be voided. Aging buckets count Manila calendar days past the due date the supplier's terms set.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D-44 | What "revenue" means, on every page                                                        | **One SQL base, in `reports/services/measures.ts`.** Realised orders (Paid through Completed, the set customer lifetime value already counts), dated by the Manila day they were placed. Revenue = total less refunds (VAT inclusive, shipping included); output VAT = order VAT less the VAT inside its refunds; net sales = revenue less output VAT; COGS = the cost snapshot less the cost of units a return put back on the shelf. A refund is netted against its order rather than dated on its own day, so a month settles as returns arrive. Warranty replacement orders are excluded; their cost is a P&L line (D-20). Fully refunded orders are not sales; the cost a refund did not recover is its own P&L line. Product and category figures are line totals before refunds, shown with a bridge (merchandise plus shipping less refunds equals revenue) rather than guessing which product a goodwill refund belonged to. `db:verify` reconciles every breakdown, the P&L and the VAT summary against independent SQL for four ranges. |
| D-45 | Receivables with no customer payment terms                                                 | Terms follow the channel: B2B 30 days, every other channel 7 (a transfer clearing, a courier remitting COD). Receivables are placed orders not yet paid; aging reuses the payables buckets so both halves of the report read alike.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D-46 | Comparison periods                                                                         | Every range compares with the one before it, clipped to the same elapsed time. When the prior period begins before the first recorded sale, deltas, ghost lines and prior columns are dropped and the page says so: a year compared with the five days before the books began is noise, not insight. Up to 31 days buckets by day, up to 92 by ISO week (Monday start), longer by month.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D-47 | Inventory valuation "as of" a date                                                         | Replayed from the ledger: each position's last `balanceAfter` and each variant's last `avgCostAfterCentavos` before the cut-off. As of now it must equal StockLevel times average cost, which `db:verify` checks. Units in transit between warehouses are in neither until received.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D-48 | Expense levels in the seed                                                                 | **Changed in Phase 10:** the Phase 1 expense seed ran payroll at PHP 428k a month against about PHP 19M of annual net sales, an operating loss every month. Rescaled so operating costs sit near a third of net sales: a thin, believable single-digit operating margin with the post-holiday months dipping below zero. `db:verify` holds it between 1 and 15 percent. Expenses are entered VAT inclusive; the input VAT is split out once, on save.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D-39 | Barcode focus on a tablet                                                                  | The scan field takes focus on load, and any printable key pressed while focus is elsewhere is routed back to it, so a scanner never types into a button. Taps never focus the field themselves, because on a tablet that raises the on-screen keyboard after every tap. Enter adds the exact SKU or barcode match; Enter on an empty field opens payment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

### 8.3 Open risks to manage during the build

| #    | Risk                                                                                                                                                                  | Mitigation                                                                                                                                                                                                                  |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RK-1 | **Scope.** Roughly 40 models, 60+ routes and 11 report types. The realistic failure mode is a broad, shallow app with TODO screens, which SPEC 11 explicitly forbids. | Phase order is ruthless and each phase ends green and committed. If time runs short, whole later modules are cut cleanly and noted in the README, rather than every module being left half-built.                           |
| RK-2 | Dashboard and report queries over 400+ orders with joins are the most likely source of N+1 and slow pages.                                                            | Aggregates are raw SQL or `groupBy` against explicit indexes, never Prisma `include` trees. Every list page is server-paginated from day one. A query-count assertion guards the dashboard in tests.                        |
| RK-3 | Seeding 400+ orders through the real services is correct but slow; seeding by direct insert is fast but hides bugs in exactly the code the demo depends on.           | Seed routes through the real services so the 6.5 invariants hold on seeded data, batched inside transactions. If the seed exceeds about 60 seconds, movement rows get batch-inserted while the service still computes them. |
| RK-4 | Tailwind v4 plus shadcn theming is still moving, and a token mistake shows up in every screenshot at once.                                                            | Tokens land in one `@theme` block in Phase 0 and are verified with the contrast script and a component-gallery screenshot before any real page is built.                                                                    |
| RK-5 | Six screenshot variants per page across 30+ pages is a lot of manual looking.                                                                                         | Capture is scripted in `scripts/shoot.ts` with a page manifest, so it is one command per phase and the effort goes into reviewing output rather than producing it.                                                          |
| RK-6 | POS carries the most demo weight and the most interaction risk: barcode focus management, split payments, change calculation, printing.                               | POS gets its own phase and its own e2e spec, and is built only after the order service is already proven by the non-POS order flow.                                                                                         |

---

## 9. Phase order

1. **Phase 0, tooling.** Repo, Docker Postgres, Next 15, Tailwind v4 tokens, shadcn theme, fonts, taste-skill and `DESIGN.md` in place, Playwright CLI, `lib/env.ts`, CI, component-gallery screenshot.
2. **Phase 1, schema and seed.** Full Prisma schema, raw SQL migration for constraints and trigram indexes, complete deterministic seed, `db:verify` invariants.
3. **Phase 2, auth and RBAC.** Auth.js v5, login rate limiting, permission matrix, middleware, `requirePermission`, audit log, app shell with sidebar, breadcrumbs, command palette, theme toggle, 403 and 404.
4. **Phase 3, catalogue and inventory.** Products, variants, categories, brands, the data-table shell, the stock ledger service, adjustments, transfers, alerts, CSV import and export, bulk price update.
5. **Phase 4, orders and POS.** Order service with transactions, order list and detail, status timeline, payments, promos, POS register, printable receipt and invoice, returns, warranty.
6. **Phase 5, CRM.** Customers and Customer 360, lead kanban, activities, tickets, segments.
7. **Phase 6, purchasing.** Suppliers, POs, receiving with moving-average cost, bills, payments, payables.
8. **Phase 7, finance and reports.** Role-aware dashboard, all reports, CSV export, expenses, P&L, VAT summary.
9. **Phase 8, polish and docs.** Notification centre, accessibility pass, empty and loading states everywhere, full screenshot sweep, README with Mermaid ERD and architecture diagram, `docs/design-direction.md`.

Every phase ends with typecheck, lint, unit tests, a Playwright verification pass, and one commit.
