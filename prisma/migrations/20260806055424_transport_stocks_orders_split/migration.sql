-- AlterEnum
ALTER TYPE "DocumentKind" ADD VALUE 'TRANSPORT_BILL';

-- AlterTable
ALTER TABLE "amendments" ADD COLUMN     "applied" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "bills" ADD COLUMN     "transportCum" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "projectOrderId" TEXT,
ADD COLUMN     "transportId" TEXT;

-- AlterTable
ALTER TABLE "po_items" ADD COLUMN     "make" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "orderId" TEXT,
ADD COLUMN     "splitFrom" TEXT;

-- CreateTable
CREATE TABLE "project_orders" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "date" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transports" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "transporter" TEXT,
    "ref" TEXT,
    "vehicle" TEXT,
    "challanId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_masters" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "make" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT 'Nos',
    "normKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_masters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_entries" (
    "id" TEXT NOT NULL,
    "itemMasterId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_orders_projectId_idx" ON "project_orders"("projectId");

-- CreateIndex
CREATE INDEX "transports_projectId_date_idx" ON "transports"("projectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "item_masters_normKey_key" ON "item_masters"("normKey");

-- CreateIndex
CREATE INDEX "stock_entries_itemMasterId_date_idx" ON "stock_entries"("itemMasterId", "date");

-- CreateIndex
CREATE INDEX "po_items_orderId_idx" ON "po_items"("orderId");

-- AddForeignKey
ALTER TABLE "po_items" ADD CONSTRAINT "po_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "project_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_orders" ADD CONSTRAINT "project_orders_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transports" ADD CONSTRAINT "transports_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transports" ADD CONSTRAINT "transports_challanId_fkey" FOREIGN KEY ("challanId") REFERENCES "challans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_entries" ADD CONSTRAINT "stock_entries_itemMasterId_fkey" FOREIGN KEY ("itemMasterId") REFERENCES "item_masters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_transportId_fkey" FOREIGN KEY ("transportId") REFERENCES "transports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_projectOrderId_fkey" FOREIGN KEY ("projectOrderId") REFERENCES "project_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
