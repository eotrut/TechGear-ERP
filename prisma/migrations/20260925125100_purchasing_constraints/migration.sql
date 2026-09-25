-- Purchasing constraints Prisma cannot express in schema.prisma.
-- Same role as 20260920140000_constraints: the last line of defence if a code
-- path ever bypasses the purchasing services.

-- A line can never be received past what was ordered. Over-deliveries are
-- refused at the dock; extra units come in as a count correction.
ALTER TABLE "PurchaseOrderItem"
  ADD CONSTRAINT "PurchaseOrderItem_received_within_ordered"
  CHECK ("qtyReceived" <= "qtyOrdered" AND "unitCostCentavos" >= 0 AND "lineTotalCentavos" >= 0);

ALTER TABLE "PurchaseReceiptItem"
  ADD CONSTRAINT "PurchaseReceiptItem_quantities"
  CHECK ("qtyReceived" >= 0 AND "qtyRejected" >= 0 AND "qtyReceived" + "qtyRejected" > 0
         AND "unitCostCentavos" >= 0);

-- A bill is never paid past its total, and never carries a negative amount.
ALTER TABLE "SupplierBill"
  ADD CONSTRAINT "SupplierBill_amounts"
  CHECK ("totalCentavos" > 0 AND "subtotalCentavos" >= 0 AND "vatCentavos" >= 0
         AND "amountPaidCentavos" >= 0 AND "amountPaidCentavos" <= "totalCentavos"
         AND "dueDate" >= "issueDate");

ALTER TABLE "SupplierPayment"
  ADD CONSTRAINT "SupplierPayment_amount_positive" CHECK ("amountCentavos" > 0);
