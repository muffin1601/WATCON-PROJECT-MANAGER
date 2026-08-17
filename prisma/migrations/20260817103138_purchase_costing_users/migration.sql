-- CreateEnum
CREATE TYPE "StockEntryType" AS ENUM ('PURCHASE', 'ADJUST_IN', 'ADJUST_OUT');

-- CreateEnum
CREATE TYPE "RfqStatus" AS ENUM ('SENT', 'COMPARING', 'PO_ISSUED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'USER');

-- AlterTable
ALTER TABLE "po_line_items" ADD COLUMN     "make" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "projectNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "receivedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
ADD COLUMN     "remark" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "costing" JSONB;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "deliverTo" TEXT,
ADD COLUMN     "delivery" TEXT,
ADD COLUMN     "payment" TEXT,
ADD COLUMN     "rfqId" TEXT,
ADD COLUMN     "transport" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "transportGst" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "transportNote" TEXT,
ALTER COLUMN "projectId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "quotations" ADD COLUMN     "costing" JSONB;

-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "poNext" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "poPrefix" TEXT NOT NULL DEFAULT 'WI/PO/',
ADD COLUMN     "rfqNext" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "rfqPrefix" TEXT NOT NULL DEFAULT 'WI/RFQ/';

-- AlterTable
ALTER TABLE "stock_entries" ADD COLUMN     "rate" DECIMAL(14,2),
ADD COLUMN     "ref" TEXT,
ADD COLUMN     "type" "StockEntryType" NOT NULL DEFAULT 'ADJUST_IN',
ADD COLUMN     "vendor" TEXT;

-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "contact" TEXT;

-- CreateTable
CREATE TABLE "rfqs" (
    "id" TEXT NOT NULL,
    "no" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "due" TIMESTAMP(3),
    "deliverTo" TEXT,
    "note" TEXT,
    "status" "RfqStatus" NOT NULL DEFAULT 'SENT',
    "projectIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rfqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_lines" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "make" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT 'Nos',
    "category" TEXT,
    "required" DECIMAL(14,3) NOT NULL,
    "stock" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "qty" DECIMAL(14,3) NOT NULL,
    "projectNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "chosenVendorId" TEXT,

    CONSTRAINT "rfq_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_vendors" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,

    CONSTRAINT "rfq_vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_responses" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "quotedBy" TEXT,
    "contact" TEXT,
    "ref" TEXT,
    "validity" INTEGER,
    "transport" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "transportGst" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "transportNote" TEXT,
    "delivery" TEXT,
    "payment" TEXT,
    "remarks" TEXT,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "filledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rfq_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_offers" (
    "id" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "rate" DECIMAL(14,2),
    "gstPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "remark" TEXT,

    CONSTRAINT "rfq_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "normUsername" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "perms" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rfqs_no_key" ON "rfqs"("no");

-- CreateIndex
CREATE INDEX "rfqs_status_date_idx" ON "rfqs"("status", "date");

-- CreateIndex
CREATE INDEX "rfq_lines_rfqId_idx" ON "rfq_lines"("rfqId");

-- CreateIndex
CREATE INDEX "rfq_vendors_rfqId_idx" ON "rfq_vendors"("rfqId");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_vendors_rfqId_vendorId_key" ON "rfq_vendors"("rfqId", "vendorId");

-- CreateIndex
CREATE INDEX "rfq_responses_rfqId_idx" ON "rfq_responses"("rfqId");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_responses_rfqId_vendorId_key" ON "rfq_responses"("rfqId", "vendorId");

-- CreateIndex
CREATE INDEX "rfq_offers_lineId_idx" ON "rfq_offers"("lineId");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_offers_responseId_lineId_key" ON "rfq_offers"("responseId", "lineId");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_normUsername_key" ON "users"("normUsername");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "rfqs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_lines" ADD CONSTRAINT "rfq_lines_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_vendors" ADD CONSTRAINT "rfq_vendors_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_vendors" ADD CONSTRAINT "rfq_vendors_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_responses" ADD CONSTRAINT "rfq_responses_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_responses" ADD CONSTRAINT "rfq_responses_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_offers" ADD CONSTRAINT "rfq_offers_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "rfq_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_offers" ADD CONSTRAINT "rfq_offers_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "rfq_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
