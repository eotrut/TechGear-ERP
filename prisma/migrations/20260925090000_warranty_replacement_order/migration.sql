-- AlterTable
ALTER TABLE "WarrantyClaim" ADD COLUMN     "replacementOrderId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "WarrantyClaim_replacementOrderId_key" ON "WarrantyClaim"("replacementOrderId");

-- AddForeignKey
ALTER TABLE "WarrantyClaim" ADD CONSTRAINT "WarrantyClaim_replacementOrderId_fkey" FOREIGN KEY ("replacementOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

