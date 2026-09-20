-- Constraints Prisma cannot express in schema.prisma.
-- See docs/PLAN.md section 1 and section 6.4 ("Preventing overselling", defence 2).

-- ---------------------------------------------------------------------------
-- 1. Stock can never go negative, and reservations can never exceed on-hand.
--    Last line of defence if any code path bypasses the stock service.
-- ---------------------------------------------------------------------------
ALTER TABLE "StockLevel"
  ADD CONSTRAINT "StockLevel_nonnegative"
  CHECK ("onHand" >= 0 AND "reserved" >= 0 AND "reserved" <= "onHand");

-- ---------------------------------------------------------------------------
-- 2. A promo is either PERCENT with basis points or FIXED with centavos.
--    Never both, never neither.
-- ---------------------------------------------------------------------------
ALTER TABLE "Promo"
  ADD CONSTRAINT "Promo_value_shape"
  CHECK (
    ("type" = 'PERCENT' AND "percentBps" IS NOT NULL AND "amountCentavos" IS NULL)
    OR
    ("type" = 'FIXED' AND "amountCentavos" IS NOT NULL AND "percentBps" IS NULL)
  );

-- ---------------------------------------------------------------------------
-- 3. Quantities and money are never negative where the domain forbids it.
-- ---------------------------------------------------------------------------
ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_quantities"
  CHECK ("qty" > 0 AND "qtyReturned" >= 0 AND "qtyReturned" <= "qty");

ALTER TABLE "PurchaseOrderItem"
  ADD CONSTRAINT "PurchaseOrderItem_quantities"
  CHECK ("qtyOrdered" > 0 AND "qtyReceived" >= 0);

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_positive" CHECK ("amountCentavos" > 0);

ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_amount_positive" CHECK ("amountCentavos" > 0);

-- ---------------------------------------------------------------------------
-- 4. Partial index for revenue rollups. The dashboard and every sales report
--    filter to realised revenue, a small slice of all orders.
-- ---------------------------------------------------------------------------
CREATE INDEX "Order_realised_revenue"
  ON "Order" ("placedAt", "channel")
  WHERE "status" IN ('PAID', 'PACKED', 'SHIPPED', 'DELIVERED', 'COMPLETED');
